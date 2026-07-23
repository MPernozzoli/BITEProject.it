-- Fix: admin_create_voyage_booking_invite_by_email stopped generating an id for the
-- placeholder profile it creates for a not-yet-registered invitee.
--
-- 20260721140100_booking_require_payment_before_review.sql rewrote this function and, in the
-- rewrite, dropped the `id` column (and its gen_random_uuid() value) from the
-- `insert into public.profiles` statement. public.profiles.id has no column default and is
-- NOT NULL (it normally mirrors auth.users.id), so every invite to a brand-new email since then
-- has failed with "null value in column \"id\" of relation \"profiles\" violates not-null
-- constraint". This restores the explicit gen_random_uuid(), unrelated to the rest of that
-- migration's payment-gate changes, which are left untouched.

create or replace function public.admin_create_voyage_booking_invite_by_email(
  _voyage_id uuid,
  _email text,
  _leg_ids uuid[],
  _first_name text default null,
  _last_name text default null,
  _status public.voyage_booking_status default 'admin_approved',
  _message text default null,
  _admin_notes text default null,
  _allow_over_capacity boolean default true,
  _is_comped boolean default false
)
returns table (booking_request_id uuid, participant_id uuid, over_capacity boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(nullif(trim(coalesce(_email, '')), ''));
  v_profile_id uuid;
  v_selected_leg_count integer;
  v_exceeds_capacity boolean := false;
  v_request_id uuid;
  v_participant_id uuid;
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'Only admins can create bookings' using errcode = '42501';
  end if;

  if v_email is null or position('@' in v_email) <= 1 then
    raise exception 'Valid email is required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(_voyage_id::text, 0));
  perform public.deactivate_past_voyage_bookable_legs();

  select profile.id
  into v_profile_id
  from public.profiles profile
  where lower(profile.email) = v_email
  order by profile.created_at asc nulls last, profile.id asc
  limit 1;

  if v_profile_id is null then
    insert into public.profiles (id, email, name)
    values (
      gen_random_uuid(),
      v_email,
      coalesce(
        nullif(trim(concat_ws(' ', _first_name, _last_name)), ''),
        split_part(v_email, '@', 1)
      )
    )
    returning id into v_profile_id;
  end if;

  select count(*)
  into v_selected_leg_count
  from public.voyage_bookable_legs leg
  where leg.voyage_id = _voyage_id
    and leg.is_bookable = true
    and public.voyage_leg_is_bookable_now(
      leg.actual_departure_at,
      leg.actual_arrival_at,
      leg.starts_at_window_start,
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
      and request.status in ('pending_payment', 'requested', 'waitlisted', 'admin_approved', 'user_confirmed')
      and (request.expires_at is null or request.expires_at > timezone('utc', now()))
      and (
        request.profile_id = v_profile_id
        or lower(coalesce(profile.email, '')) = v_email
        or lower(coalesce(participant.email, '')) = v_email
      )
  ) then
    raise exception 'duplicate_leg_booking' using errcode = 'BK001';
  end if;

  if _status in ('admin_approved', 'user_confirmed') then
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
    confirmed_at,
    is_comped
  )
  values (
    _voyage_id,
    v_profile_id,
    1,
    _status,
    'each_pays_own',
    nullif(trim(coalesce(_message, '')), ''),
    nullif(trim(coalesce(_admin_notes, '')), ''),
    case when _status = 'user_confirmed' then timezone('utc', now()) else null end,
    coalesce(_is_comped, false)
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
