-- Admin notifications for voyage booking activity: new requests, cancellations and
-- traveller-initiated modifications (guest list / payment mode changes, confirmations).
--
-- Reuses the existing voyage_booking_notifications queue + dispatch-voyage-booking-notifications
-- pipeline, fanning a copy of the event out to every admin profile in addition to the
-- traveller-facing notification that already existed.

-- 1. Allow one row per (booking_request_id, event_type, recipient) so the same event can be
--    queued once for the traveller and once per admin without unique-violation errors.
drop index if exists public.voyage_booking_notifications_once_idx;
create unique index if not exists voyage_booking_notifications_once_idx
  on public.voyage_booking_notifications(booking_request_id, event_type, recipient_profile_id);

-- 2. Widen the allowed event types with the new admin-facing variants.
alter table public.voyage_booking_notifications
  drop constraint if exists voyage_booking_notifications_event_type_check;
alter table public.voyage_booking_notifications
  add constraint voyage_booking_notifications_event_type_check check (
    event_type in (
      'requested',
      'waitlisted',
      'admin_approved',
      'user_confirmed',
      'cancelled',
      'rejected',
      'promoted_from_waitlist',
      'manual_added',
      'admin_new_booking',
      'admin_cancelled',
      'admin_modified'
    )
  );

-- 3. enqueue_voyage_booking_notification: match the widened unique index in ON CONFLICT.
create or replace function public.enqueue_voyage_booking_notification(
  _booking_request_id uuid,
  _event_type text,
  _metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  recipient_id uuid;
  notification_id uuid;
begin
  select profile_id
  into recipient_id
  from public.voyage_booking_requests
  where id = _booking_request_id;

  if recipient_id is null then
    raise exception 'Booking request not found' using errcode = '22023';
  end if;

  insert into public.voyage_booking_notifications (
    booking_request_id,
    recipient_profile_id,
    event_type,
    metadata
  )
  values (
    _booking_request_id,
    recipient_id,
    _event_type,
    coalesce(_metadata, '{}'::jsonb)
  )
  on conflict (booking_request_id, event_type, recipient_profile_id)
  do update set
    metadata = voyage_booking_notifications.metadata || excluded.metadata,
    failed_at = null,
    error_message = null
  returning id into notification_id;

  return notification_id;
end;
$$;

-- 4. New helper: fan a booking event out to every admin profile.
create or replace function public.enqueue_admin_voyage_booking_notifications(
  _booking_request_id uuid,
  _event_type text,
  _metadata jsonb default '{}'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_id uuid;
  sent_count integer := 0;
begin
  for admin_id in
    select ur.user_id
    from public.user_roles ur
    where ur.role = 'admin'::public.app_role
  loop
    insert into public.voyage_booking_notifications (
      booking_request_id,
      recipient_profile_id,
      event_type,
      metadata
    )
    values (
      _booking_request_id,
      admin_id,
      _event_type,
      coalesce(_metadata, '{}'::jsonb)
    )
    on conflict (booking_request_id, event_type, recipient_profile_id)
    do update set
      metadata = voyage_booking_notifications.metadata || excluded.metadata,
      processed_at = null,
      emailed_at = null,
      failed_at = null,
      error_message = null;

    sent_count := sent_count + 1;
  end loop;

  return sent_count;
end;
$$;

-- 5. New booking request (or waitlist) submitted by a traveller -> notify admins.
create or replace function public.request_voyage_booking(
  _voyage_id uuid,
  _leg_ids uuid[],
  _party_size integer default 1,
  _message text default null
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

  -- Guard: the requester cannot hold two active bookings on the same leg.
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
    message
  )
  values (
    _voyage_id,
    requester,
    _party_size,
    next_status,
    nullif(trim(coalesce(_message, '')), '')
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

-- 6. Traveller confirms an admin-approved booking -> notify admins.
create or replace function public.confirm_voyage_booking(_booking_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.voyage_booking_requests
  set
    status = 'user_confirmed',
    confirmed_at = timezone('utc', now())
  where id = _booking_request_id
    and profile_id = auth.uid()
    and status = 'admin_approved';

  if not found then
    raise exception 'Booking cannot be confirmed' using errcode = '42501';
  end if;

  perform public.enqueue_voyage_booking_notification(_booking_request_id, 'user_confirmed');
  perform public.enqueue_admin_voyage_booking_notifications(
    _booking_request_id,
    'admin_modified',
    jsonb_build_object('status', 'user_confirmed')
  );
end;
$$;

-- 7. Traveller cancels their own booking -> notify admins.
create or replace function public.cancel_voyage_booking(_booking_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  booking_voyage_id uuid;
  changed_leg_ids uuid[];
begin
  select voyage_id
  into booking_voyage_id
  from public.voyage_booking_requests
  where id = _booking_request_id
    and profile_id = auth.uid()
    and status in ('requested', 'waitlisted', 'admin_approved', 'user_confirmed');

  if booking_voyage_id is null then
    raise exception 'Booking cannot be cancelled' using errcode = '42501';
  end if;

  select array_agg(bookable_leg_id)
  into changed_leg_ids
  from public.voyage_booking_request_legs
  where booking_request_id = _booking_request_id;

  perform pg_advisory_xact_lock(hashtextextended(booking_voyage_id::text, 0));

  update public.voyage_booking_requests
  set
    status = 'cancelled',
    cancelled_at = timezone('utc', now())
  where id = _booking_request_id;

  perform public.enqueue_voyage_booking_notification(_booking_request_id, 'cancelled');
  perform public.enqueue_admin_voyage_booking_notifications(_booking_request_id, 'admin_cancelled');
  perform public.promote_waitlisted_voyage_bookings(booking_voyage_id, changed_leg_ids);
end;
$$;

-- 8. Traveller updates their guest list / payment split -> notify admins.
create or replace function public.set_booking_participants(
  _booking_request_id uuid,
  _payment_mode text,
  _participants jsonb
)
returns setof public.voyage_booking_participants
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.voyage_booking_requests%rowtype;
  v_lead_email text;
  v_expected_guests integer;
  v_guest jsonb;
  v_guest_count integer := 0;
begin
  select * into v_request
  from public.voyage_booking_requests
  where id = _booking_request_id;

  if not found then
    raise exception 'booking_not_found';
  end if;
  if v_request.profile_id <> auth.uid() then
    raise exception 'not_booking_owner';
  end if;
  if v_request.status not in ('requested', 'waitlisted', 'admin_approved', 'user_confirmed') then
    raise exception 'booking_not_active';
  end if;
  if _payment_mode not in ('lead_pays_all', 'each_pays_own') then
    raise exception 'invalid_payment_mode';
  end if;

  v_expected_guests := greatest(0, v_request.party_size - 1);
  if jsonb_typeof(_participants) <> 'array' then
    raise exception 'participants_not_array';
  end if;
  if jsonb_array_length(_participants) <> v_expected_guests then
    raise exception 'participant_count_mismatch';
  end if;

  update public.voyage_booking_requests
  set payment_mode = _payment_mode, updated_at = timezone('utc', now())
  where id = _booking_request_id;

  -- Lead participant (the booker) — already accepted the conditions at booking time.
  select email into v_lead_email from public.profiles where id = auth.uid();
  insert into public.voyage_booking_participants (
    booking_request_id, profile_id, email, is_lead, status, conditions_accepted_at, accepted_at
  )
  values (
    _booking_request_id, auth.uid(), coalesce(v_lead_email, ''), true, 'accepted',
    timezone('utc', now()), timezone('utc', now())
  )
  on conflict (booking_request_id, lower(email)) do update
  set is_lead = true, profile_id = auth.uid(), status = 'accepted', updated_at = timezone('utc', now());

  -- Replace the guest set: drop previous non-lead rows, re-insert from the payload.
  delete from public.voyage_booking_participants
  where booking_request_id = _booking_request_id and is_lead = false;

  for v_guest in select * from jsonb_array_elements(_participants)
  loop
    v_guest_count := v_guest_count + 1;
    insert into public.voyage_booking_participants (
      booking_request_id, profile_id, email, first_name, last_name, status, expires_at
    )
    values (
      _booking_request_id,
      (select id from public.profiles where lower(email) = lower(v_guest ->> 'email') limit 1),
      lower(trim(v_guest ->> 'email')),
      nullif(trim(v_guest ->> 'first_name'), ''),
      nullif(trim(v_guest ->> 'last_name'), ''),
      'pending',
      timezone('utc', now()) + interval '7 days'
    );
  end loop;

  perform public.enqueue_admin_voyage_booking_notifications(
    _booking_request_id,
    'admin_modified',
    jsonb_build_object('guest_count', v_guest_count, 'payment_mode', _payment_mode)
  );

  return query
    select * from public.voyage_booking_participants
    where booking_request_id = _booking_request_id
    order by is_lead desc, created_at asc;
end;
$$;

-- 9. Invited guest declines -> party size shrinks; notify admins of the change.
create or replace function public.decline_booking_participation(_participant_id uuid)
returns public.voyage_booking_participants
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.voyage_booking_participants%rowtype;
begin
  select * into v_row from public.voyage_booking_participants where id = _participant_id;
  if not found then
    raise exception 'participation_not_found';
  end if;
  if v_row.profile_id <> auth.uid()
     and lower(v_row.email) <> lower(coalesce(auth.jwt() ->> 'email', '')) then
    raise exception 'not_your_participation';
  end if;

  update public.voyage_booking_participants
  set status = 'declined', updated_at = timezone('utc', now())
  where id = _participant_id
  returning * into v_row;

  -- Free the seat: reduce party size (never below 1).
  update public.voyage_booking_requests
  set party_size = greatest(1, party_size - 1), updated_at = timezone('utc', now())
  where id = v_row.booking_request_id;

  perform public.enqueue_admin_voyage_booking_notifications(
    v_row.booking_request_id,
    'admin_modified',
    jsonb_build_object('declined_participant_id', v_row.id)
  );

  return v_row;
end;
$$;

-- 10. Grants for the new helper function (mirrors enqueue_voyage_booking_notification's grants).
revoke execute on function public.enqueue_admin_voyage_booking_notifications(uuid, text, jsonb) from public, anon;
grant execute on function public.enqueue_admin_voyage_booking_notifications(uuid, text, jsonb) to authenticated, service_role;
