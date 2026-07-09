create table if not exists public.voyage_booking_notifications (
  id uuid primary key default gen_random_uuid(),
  booking_request_id uuid not null references public.voyage_booking_requests(id) on delete cascade,
  recipient_profile_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null,
  queued_at timestamptz not null default timezone('utc', now()),
  processed_at timestamptz,
  emailed_at timestamptz,
  failed_at timestamptz,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  constraint voyage_booking_notifications_event_type_check check (
    event_type in (
      'requested',
      'waitlisted',
      'admin_approved',
      'user_confirmed',
      'cancelled',
      'rejected',
      'promoted_from_waitlist',
      'manual_added'
    )
  )
);

create unique index if not exists voyage_booking_notifications_once_idx
  on public.voyage_booking_notifications(booking_request_id, event_type);

create index if not exists voyage_booking_notifications_pending_idx
  on public.voyage_booking_notifications(queued_at)
  where processed_at is null and failed_at is null;

alter table public.voyage_booking_notifications enable row level security;

grant select on public.voyage_booking_notifications to authenticated;
grant insert, update on public.voyage_booking_notifications to service_role;

drop policy if exists "Users read own booking notifications" on public.voyage_booking_notifications;
create policy "Users read own booking notifications"
  on public.voyage_booking_notifications
  for select
  to authenticated
  using (
    recipient_profile_id = auth.uid()
    or public.has_role(auth.uid(), 'admin'::public.app_role)
  );

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
  on conflict (booking_request_id, event_type)
  do update set
    metadata = voyage_booking_notifications.metadata || excluded.metadata,
    failed_at = null,
    error_message = null
  returning id into notification_id;

  return notification_id;
end;
$$;

create or replace function public.request_voyage_booking(
  _voyage_id uuid,
  _leg_ids uuid[],
  _party_size integer default 1,
  _message text default null
)
returns table (booking_request_id uuid, booking_status public.voyage_booking_status)
language plpgsql
security definer
set search_path = public
as $$
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

  booking_request_id := new_request_id;
  booking_status := next_status;
  return next;
end;
$$;

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
end;
$$;

create or replace function public.promote_waitlisted_voyage_bookings(
  _voyage_id uuid,
  _changed_leg_ids uuid[] default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate record;
  candidate_leg_ids uuid[];
  promoted_count integer := 0;
begin
  for candidate in
    select *
    from public.voyage_booking_requests
    where voyage_id = _voyage_id
      and status = 'waitlisted'
    order by requested_at asc, id asc
  loop
    select array_agg(bookable_leg_id)
    into candidate_leg_ids
    from public.voyage_booking_request_legs
    where booking_request_id = candidate.id;

    if coalesce(array_length(candidate_leg_ids, 1), 0) = 0 then
      continue;
    end if;

    if _changed_leg_ids is not null and not (candidate_leg_ids && _changed_leg_ids) then
      continue;
    end if;

    if not public.admin_booking_over_capacity(candidate.voyage_id, candidate_leg_ids, candidate.party_size, candidate.id) then
      update public.voyage_booking_requests
      set
        status = 'requested',
        admin_notes = concat_ws(
          E'\n',
          nullif(admin_notes, ''),
          'Promosso automaticamente dalla waiting list per disponibilita posti.'
        )
      where id = candidate.id;

      perform public.enqueue_voyage_booking_notification(candidate.id, 'promoted_from_waitlist');
      promoted_count := promoted_count + 1;
    end if;
  end loop;

  return promoted_count;
end;
$$;

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
  perform public.promote_waitlisted_voyage_bookings(booking_voyage_id, changed_leg_ids);
end;
$$;

create or replace function public.admin_set_voyage_booking_status(
  _booking_request_id uuid,
  _status public.voyage_booking_status,
  _allow_over_capacity boolean default false,
  _admin_notes text default null
)
returns table (booking_request_id uuid, over_capacity boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  booking record;
  leg_ids uuid[];
  previous_status public.voyage_booking_status;
  exceeds_capacity boolean := false;
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'Only admins can update booking status' using errcode = '42501';
  end if;

  select *
  into booking
  from public.voyage_booking_requests
  where id = _booking_request_id
  for update;

  if booking.id is null then
    raise exception 'Booking request not found' using errcode = '22023';
  end if;

  previous_status := booking.status;
  perform pg_advisory_xact_lock(hashtextextended(booking.voyage_id::text, 0));

  select array_agg(bookable_leg_id)
  into leg_ids
  from public.voyage_booking_request_legs
  where booking_request_id = _booking_request_id;

  if _status in ('requested', 'admin_approved', 'user_confirmed') then
    exceeds_capacity := public.admin_booking_over_capacity(
      booking.voyage_id,
      coalesce(leg_ids, array[]::uuid[]),
      booking.party_size,
      _booking_request_id
    );
    if exceeds_capacity and not _allow_over_capacity then
      raise exception 'Booking exceeds voyage capacity' using errcode = '22023';
    end if;
  end if;

  update public.voyage_booking_requests
  set
    status = _status,
    admin_notes = coalesce(nullif(trim(_admin_notes), ''), admin_notes),
    confirmed_at = case when _status = 'user_confirmed' then timezone('utc', now()) else confirmed_at end,
    cancelled_at = case when _status = 'cancelled' then timezone('utc', now()) else cancelled_at end
  where id = _booking_request_id;

  if _status in ('admin_approved', 'user_confirmed', 'cancelled', 'rejected') and previous_status is distinct from _status then
    perform public.enqueue_voyage_booking_notification(_booking_request_id, _status::text);
  end if;

  if previous_status in ('requested', 'admin_approved', 'user_confirmed')
    and _status not in ('requested', 'admin_approved', 'user_confirmed')
  then
    perform public.promote_waitlisted_voyage_bookings(booking.voyage_id, leg_ids);
  end if;

  booking_request_id := _booking_request_id;
  over_capacity := exceeds_capacity;
  return next;
end;
$$;

create or replace function public.admin_create_voyage_booking(
  _voyage_id uuid,
  _profile_id uuid,
  _leg_ids uuid[],
  _party_size integer default 1,
  _status public.voyage_booking_status default 'admin_approved',
  _message text default null,
  _admin_notes text default null,
  _allow_over_capacity boolean default true
)
returns table (booking_request_id uuid, over_capacity boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_leg_count integer;
  exceeds_capacity boolean := false;
  new_request_id uuid;
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'Only admins can create bookings' using errcode = '42501';
  end if;

  if coalesce(_party_size, 0) <= 0 then
    raise exception 'party_size must be positive' using errcode = '22023';
  end if;

  if not exists (select 1 from public.profiles where id = _profile_id) then
    raise exception 'Profile not found' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(_voyage_id::text, 0));
  perform public.deactivate_past_voyage_bookable_legs();

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

  if _status in ('requested', 'admin_approved', 'user_confirmed') then
    exceeds_capacity := public.admin_booking_over_capacity(_voyage_id, _leg_ids, _party_size, null);
    if exceeds_capacity and not _allow_over_capacity then
      raise exception 'Booking exceeds voyage capacity' using errcode = '22023';
    end if;
  end if;

  insert into public.voyage_booking_requests (
    voyage_id,
    profile_id,
    party_size,
    status,
    message,
    admin_notes,
    confirmed_at
  )
  values (
    _voyage_id,
    _profile_id,
    _party_size,
    _status,
    nullif(trim(coalesce(_message, '')), ''),
    nullif(trim(coalesce(_admin_notes, '')), ''),
    case when _status = 'user_confirmed' then timezone('utc', now()) else null end
  )
  returning id into new_request_id;

  insert into public.voyage_booking_request_legs (booking_request_id, bookable_leg_id)
  select new_request_id, id
  from unnest(_leg_ids) as selected_leg(id);

  perform public.enqueue_voyage_booking_notification(new_request_id, 'manual_added', jsonb_build_object('status', _status));
  if _status in ('admin_approved', 'user_confirmed', 'waitlisted') then
    perform public.enqueue_voyage_booking_notification(new_request_id, _status::text);
  end if;

  booking_request_id := new_request_id;
  over_capacity := exceeds_capacity;
  return next;
end;
$$;

revoke execute on function public.enqueue_voyage_booking_notification(uuid, text, jsonb) from public, anon;
grant execute on function public.enqueue_voyage_booking_notification(uuid, text, jsonb) to authenticated, service_role;
revoke execute on function public.request_voyage_booking(uuid, uuid[], integer, text) from public, anon;
grant execute on function public.request_voyage_booking(uuid, uuid[], integer, text) to authenticated;
revoke execute on function public.confirm_voyage_booking(uuid) from public, anon;
grant execute on function public.confirm_voyage_booking(uuid) to authenticated;
revoke execute on function public.cancel_voyage_booking(uuid) from public, anon;
grant execute on function public.cancel_voyage_booking(uuid) to authenticated;
revoke execute on function public.promote_waitlisted_voyage_bookings(uuid, uuid[]) from public, anon;
grant execute on function public.promote_waitlisted_voyage_bookings(uuid, uuid[]) to authenticated, service_role;
revoke execute on function public.admin_set_voyage_booking_status(uuid, public.voyage_booking_status, boolean, text) from public, anon;
grant execute on function public.admin_set_voyage_booking_status(uuid, public.voyage_booking_status, boolean, text) to authenticated;
revoke execute on function public.admin_create_voyage_booking(uuid, uuid, uuid[], integer, public.voyage_booking_status, text, text, boolean) from public, anon;
grant execute on function public.admin_create_voyage_booking(uuid, uuid, uuid[], integer, public.voyage_booking_status, text, text, boolean) to authenticated;
