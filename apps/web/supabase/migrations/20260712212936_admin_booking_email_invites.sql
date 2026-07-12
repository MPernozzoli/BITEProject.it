-- Admin email invites for voyage bookings.
--
-- The public lead flow already stores co-travellers as pending
-- voyage_booking_participants and sends the voyage-participant-invite email.
-- This adds the missing admin path: admins can add an unregistered email to a
-- leg, send the same invite, and let the person sign up before accepting the
-- participation form.

alter table public.voyage_booking_requests
  add column if not exists candidate_info jsonb;

drop function if exists public.request_voyage_booking(uuid, uuid[], integer, text);
create or replace function public.request_voyage_booking(
  _voyage_id uuid,
  _leg_ids uuid[],
  _party_size integer default 1,
  _message text default null,
  _candidate_info jsonb default null
)
returns table(booking_request_id uuid, booking_status public.voyage_booking_status)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  requester uuid := auth.uid();
  capacity integer;
  selected_leg_count integer;
  full_leg_count integer;
  next_status public.voyage_booking_status;
  new_request_id uuid;
begin
  if requester is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if not exists (select 1 from public.profiles where id = requester) then
    insert into public.profiles (id, email, name)
    select
      u.id,
      coalesce(u.email, ''),
      coalesce(
        nullif(trim(u.raw_user_meta_data ->> 'name'), ''),
        nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''),
        nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
        'Guest'
      )
    from auth.users u
    where u.id = requester
    on conflict (id) do nothing;
  end if;

  if coalesce(_party_size, 0) <= 0 then
    raise exception 'party_size must be positive' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(_voyage_id::text, 0));
  perform public.deactivate_past_voyage_bookable_legs();

  select booking_max_guests
  into capacity
  from public.voyages
  where id = _voyage_id
    and booking_enabled = true
    and is_published = true;

  if capacity is null then
    raise exception 'Voyage is not bookable' using errcode = '22023';
  end if;

  if _party_size > capacity then
    raise exception 'party_size exceeds voyage capacity' using errcode = '22023';
  end if;

  select count(*)
  into selected_leg_count
  from public.voyage_bookable_legs leg
  where leg.voyage_id = _voyage_id
    and leg.is_bookable = true
    and public.booking_leg_is_current_or_future(
      leg.starts_at_window_start,
      leg.starts_at_window_end,
      leg.ends_at_window_start,
      leg.ends_at_window_end
    )
    and leg.id = any(_leg_ids);

  if selected_leg_count = 0 or selected_leg_count <> cardinality(_leg_ids) then
    raise exception 'Invalid booking legs' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.voyage_booking_request_legs link
    join public.voyage_booking_requests req on req.id = link.booking_request_id
    where link.bookable_leg_id = any(_leg_ids)
      and req.profile_id = requester
      and req.status in ('requested', 'waitlisted', 'admin_approved', 'user_confirmed')
      and (req.expires_at is null or req.expires_at > timezone('utc', now()))
  ) then
    raise exception 'duplicate_leg_booking' using errcode = 'BK001';
  end if;

  with occupied as (
    select
      link.bookable_leg_id,
      coalesce(sum(req.party_size), 0) as occupied_count
    from public.voyage_booking_request_legs link
    join public.voyage_booking_requests req
      on req.id = link.booking_request_id
    where link.bookable_leg_id = any(_leg_ids)
      and req.status in ('requested', 'admin_approved', 'user_confirmed')
      and (req.expires_at is null or req.expires_at > timezone('utc', now()))
    group by link.bookable_leg_id
  )
  select count(*)
  into full_leg_count
  from unnest(_leg_ids) as requested_leg(id)
  left join occupied on occupied.bookable_leg_id = requested_leg.id
  where coalesce(occupied.occupied_count, 0) + _party_size > capacity;

  next_status := case when full_leg_count > 0 then 'waitlisted' else 'requested' end;

  insert into public.voyage_booking_requests (
    voyage_id,
    profile_id,
    party_size,
    status,
    message,
    candidate_info
  )
  values (
    _voyage_id,
    requester,
    _party_size,
    next_status,
    nullif(trim(coalesce(_message, '')), ''),
    _candidate_info
  )
  returning id into new_request_id;

  insert into public.voyage_booking_request_legs (booking_request_id, bookable_leg_id)
  select new_request_id, id
  from unnest(_leg_ids) as selected_leg(id);

  perform public.enqueue_voyage_booking_notification(new_request_id, next_status::text);
  perform public.enqueue_admin_voyage_booking_notifications(
    new_request_id,
    'admin_new_booking',
    jsonb_build_object('status', next_status)
  );

  booking_request_id := new_request_id;
  booking_status := next_status;
  return next;
end;
$function$;

drop function if exists public.accept_booking_participation(uuid);
create or replace function public.accept_booking_participation(
  _participant_id uuid,
  _candidate_info jsonb default null
)
returns public.voyage_booking_participants
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.voyage_booking_participants%rowtype;
begin
  select * into v_row
  from public.voyage_booking_participants
  where id = _participant_id;

  if not found then
    raise exception 'participation_not_found';
  end if;
  if v_row.profile_id <> auth.uid()
     and lower(v_row.email) <> lower(coalesce(auth.jwt() ->> 'email', '')) then
    raise exception 'not_your_participation';
  end if;
  if v_row.status not in ('pending') then
    raise exception 'participation_not_pending';
  end if;

  if not exists (select 1 from public.profiles where id = auth.uid()) then
    insert into public.profiles (id, email, name)
    select
      u.id,
      coalesce(u.email, v_row.email, ''),
      coalesce(
        nullif(trim(u.raw_user_meta_data ->> 'name'), ''),
        nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''),
        nullif(trim(concat_ws(' ', v_row.first_name, v_row.last_name)), ''),
        nullif(split_part(coalesce(u.email, v_row.email, ''), '@', 1), ''),
        'Guest'
      )
    from auth.users u
    where u.id = auth.uid()
    on conflict (id) do nothing;
  end if;

  update public.voyage_booking_participants
  set profile_id = auth.uid(),
      status = 'accepted',
      conditions_accepted_at = timezone('utc', now()),
      accepted_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = _participant_id
  returning * into v_row;

  -- Admin email invites are represented as a one-person booking plus one
  -- pending participant. Once the invited person accepts, transfer the booking
  -- from the placeholder/contact profile to the real authenticated profile so
  -- it appears in their normal /bookings list.
  update public.voyage_booking_requests request
  set profile_id = auth.uid(),
      candidate_info = coalesce(_candidate_info, request.candidate_info),
      updated_at = timezone('utc', now())
  where request.id = v_row.booking_request_id
    and request.party_size = 1
    and not exists (
      select 1
      from public.voyage_booking_participants other_participant
      where other_participant.booking_request_id = request.id
        and other_participant.id <> v_row.id
    );

  return v_row;
end;
$$;

create or replace function public.admin_create_voyage_booking_invite_by_email(
  _voyage_id uuid,
  _email text,
  _leg_ids uuid[],
  _first_name text default null,
  _last_name text default null,
  _status public.voyage_booking_status default 'admin_approved',
  _message text default null,
  _admin_notes text default null,
  _allow_over_capacity boolean default false
)
returns table (booking_request_id uuid, participant_id uuid, over_capacity boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(trim(coalesce(_email, '')));
  v_profile_id uuid;
  v_selected_leg_count integer;
  v_exceeds_capacity boolean := false;
  v_request_id uuid;
  v_participant_id uuid;
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'Only admins can create booking invites' using errcode = '42501';
  end if;

  if v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Invalid email' using errcode = '22023';
  end if;

  select id into v_profile_id
  from public.profiles
  where lower(email) = v_email
  order by created_at asc
  limit 1;

  if v_profile_id is null then
    insert into public.profiles (id, email, name)
    values (
      gen_random_uuid(),
      v_email,
      coalesce(
        nullif(trim(concat_ws(' ', nullif(_first_name, ''), nullif(_last_name, ''))), ''),
        split_part(v_email, '@', 1)
      )
    )
    returning id into v_profile_id;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(_voyage_id::text, 0));
  perform public.deactivate_past_voyage_bookable_legs();

  select count(*)
  into v_selected_leg_count
  from public.voyage_bookable_legs leg
  where leg.voyage_id = _voyage_id
    and leg.is_bookable = true
    and public.booking_leg_is_current_or_future(
      leg.starts_at_window_start,
      leg.starts_at_window_end,
      leg.ends_at_window_start,
      leg.ends_at_window_end
    )
    and leg.id = any(_leg_ids);

  if v_selected_leg_count = 0 or v_selected_leg_count <> cardinality(_leg_ids) then
    raise exception 'Invalid booking legs' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.voyage_booking_request_legs link
    join public.voyage_booking_requests request on request.id = link.booking_request_id
    left join public.profiles profile on profile.id = request.profile_id
    left join public.voyage_booking_participants participant
      on participant.booking_request_id = request.id
    where link.bookable_leg_id = any(_leg_ids)
      and request.status in ('requested', 'waitlisted', 'admin_approved', 'user_confirmed')
      and (request.expires_at is null or request.expires_at > timezone('utc', now()))
      and (
        request.profile_id = v_profile_id
        or lower(coalesce(profile.email, '')) = v_email
        or lower(coalesce(participant.email, '')) = v_email
      )
  ) then
    raise exception 'duplicate_leg_booking' using errcode = 'BK001';
  end if;

  if _status in ('requested', 'admin_approved', 'user_confirmed') then
    v_exceeds_capacity := public.admin_booking_over_capacity(_voyage_id, _leg_ids, 1, null);
    if v_exceeds_capacity and not _allow_over_capacity then
      raise exception 'Booking exceeds voyage capacity' using errcode = '22023';
    end if;
  end if;

  insert into public.voyage_booking_requests (
    voyage_id,
    profile_id,
    party_size,
    status,
    payment_mode,
    message,
    admin_notes,
    confirmed_at
  )
  values (
    _voyage_id,
    v_profile_id,
    1,
    _status,
    'each_pays_own',
    nullif(trim(coalesce(_message, '')), ''),
    nullif(trim(coalesce(_admin_notes, '')), ''),
    case when _status = 'user_confirmed' then timezone('utc', now()) else null end
  )
  returning id into v_request_id;

  insert into public.voyage_booking_request_legs (booking_request_id, bookable_leg_id)
  select v_request_id, id
  from unnest(_leg_ids) as selected_leg(id);

  insert into public.voyage_booking_participants (
    booking_request_id,
    profile_id,
    email,
    first_name,
    last_name,
    is_lead,
    status,
    expires_at
  )
  values (
    v_request_id,
    v_profile_id,
    v_email,
    nullif(trim(coalesce(_first_name, '')), ''),
    nullif(trim(coalesce(_last_name, '')), ''),
    false,
    'pending',
    timezone('utc', now()) + interval '7 days'
  )
  returning id into v_participant_id;

  perform public.enqueue_voyage_booking_notification(v_request_id, 'manual_added', jsonb_build_object('status', _status));
  if _status in ('admin_approved', 'user_confirmed', 'waitlisted') then
    perform public.enqueue_voyage_booking_notification(v_request_id, _status::text);
  end if;
  perform public.enqueue_admin_voyage_booking_notifications(
    v_request_id,
    'admin_modified',
    jsonb_build_object('source', 'admin_email_invite')
  );

  booking_request_id := v_request_id;
  participant_id := v_participant_id;
  over_capacity := v_exceeds_capacity;
  return next;
end;
$$;

revoke execute on function public.request_voyage_booking(uuid, uuid[], integer, text, jsonb) from public, anon;
grant execute on function public.request_voyage_booking(uuid, uuid[], integer, text, jsonb) to authenticated;
revoke execute on function public.accept_booking_participation(uuid, jsonb) from public, anon;
grant execute on function public.accept_booking_participation(uuid, jsonb) to authenticated;
revoke execute on function public.admin_create_voyage_booking_invite_by_email(uuid, text, uuid[], text, text, public.voyage_booking_status, text, text, boolean) from public, anon;
grant execute on function public.admin_create_voyage_booking_invite_by_email(uuid, text, uuid[], text, text, public.voyage_booking_status, text, text, boolean) to authenticated;
