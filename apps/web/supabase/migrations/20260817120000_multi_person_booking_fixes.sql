-- Multi-person booking audit fixes (party_size > 1).
--
-- Three gaps, all specific to a booking that carries guests:
--
--   1. The duplicate-leg guard of request_voyage_booking only ever looked at
--      voyage_booking_requests.profile_id, so someone already sitting on a leg as somebody
--      else's *guest* could still apply for that same leg in their own name — one person,
--      two seats counted against capacity. admin_create_voyage_booking_invite_by_email
--      already did the participant-aware check; the user-facing path did not. The check is
--      extracted here into one helper both entry points can share.
--
--   2. set_booking_participants let the lead list their own email (or the same email twice)
--      among the guests, which reached the unique index and surfaced a raw Postgres error;
--      and it let the lead invite someone who already holds a seat on those same legs.
--      Both are now named domain errors the UI can translate.
--
--   3. expire_pending_booking_participants() has existed since the participants feature
--      shipped but was never scheduled (see docs/payments-bunq.md), so the 7-day invite
--      deadline never fired: a guest who never answered kept holding a seat forever — and in
--      'each_pays_own' a seat that was never paid for. It is scheduled here, and narrowed so
--      it only touches bookings that are actually live.

-- ---------------------------------------------------------------------------
-- 1. Shared leg-conflict guard (booker *or* guest)
-- ---------------------------------------------------------------------------

create or replace function public.voyage_leg_booking_conflict_exists(
  _leg_ids uuid[],
  _profile_id uuid,
  _email text,
  _excluding_request_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.voyage_booking_request_legs link
    join public.voyage_booking_requests req
      on req.id = link.booking_request_id
    left join public.voyage_booking_participants part
      on part.booking_request_id = req.id
     and part.status in ('pending', 'accepted')
    where link.bookable_leg_id = any(_leg_ids)
      and (_excluding_request_id is null or req.id <> _excluding_request_id)
      and req.status in ('pending_payment', 'requested', 'waitlisted', 'admin_approved', 'user_confirmed')
      and (req.expires_at is null or req.expires_at > timezone('utc', now()))
      and (
        (_profile_id is not null and req.profile_id = _profile_id)
        or (_profile_id is not null and part.profile_id = _profile_id)
        or (_email is not null and lower(part.email) = _email)
      )
  );
$$;

comment on function public.voyage_leg_booking_conflict_exists(uuid[], uuid, text, uuid) is
  'Whether a person (by profile and/or email) already holds an active place on any of these legs — as the booker of a request or as a pending/accepted guest on someone else''s. Single source of truth for the duplicate-leg guard.';

revoke execute on function public.voyage_leg_booking_conflict_exists(uuid[], uuid, text, uuid) from public, anon;
grant execute on function public.voyage_leg_booking_conflict_exists(uuid[], uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. request_voyage_booking: participant-aware duplicate guard
--    (body otherwise identical to 20260721140100_booking_require_payment_before_review)
-- ---------------------------------------------------------------------------

create or replace function public.request_voyage_booking(
  _voyage_id uuid,
  _leg_ids uuid[],
  _party_size integer default 1,
  _message text default null,
  _candidate_info jsonb default '{}'::jsonb
)
returns table(booking_request_id uuid, booking_status public.voyage_booking_status)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  requester uuid := auth.uid();
  requester_email text;
  capacity integer;
  selected_leg_count integer;
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
    and public.voyage_leg_is_bookable_now(
      leg.actual_departure_at,
      leg.actual_arrival_at,
      leg.starts_at_window_start,
      leg.ends_at_window_end
    )
    and leg.id = any(_leg_ids);

  if selected_leg_count = 0 or selected_leg_count <> cardinality(_leg_ids) then
    raise exception 'Invalid booking legs' using errcode = '22023';
  end if;

  -- 'pending_payment' joins the duplicate guard so a user cannot stack half-finished
  -- applications on the same leg; the grace deadline below makes it self-healing. The guard
  -- now also covers being someone else's guest on those legs — see
  -- voyage_leg_booking_conflict_exists.
  requester_email := lower(nullif(trim(coalesce(
    auth.jwt() ->> 'email',
    (select p.email from public.profiles p where p.id = requester)
  )), ''));

  if public.voyage_leg_booking_conflict_exists(_leg_ids, requester, requester_email, null) then
    raise exception 'duplicate_leg_booking' using errcode = 'BK001';
  end if;

  insert into public.voyage_booking_requests (
    voyage_id,
    profile_id,
    party_size,
    status,
    message,
    candidate_info,
    expires_at
  )
  values (
    _voyage_id,
    requester,
    _party_size,
    'pending_payment',
    nullif(trim(coalesce(_message, '')), ''),
    case
      when jsonb_typeof(coalesce(_candidate_info, '{}'::jsonb)) = 'object' then coalesce(_candidate_info, '{}'::jsonb)
      else '{}'::jsonb
    end,
    timezone('utc', now()) + interval '1 hour'
  )
  returning id into new_request_id;

  insert into public.voyage_booking_request_legs (booking_request_id, bookable_leg_id)
  select new_request_id, id
  from unnest(_leg_ids) as selected_leg(id);

  -- No notification here on purpose: the applicant has not paid yet, so neither they nor
  -- the admins should be told a candidature exists. settle_voyage_booking_payment does it.

  booking_request_id := new_request_id;
  booking_status := 'pending_payment';
  return next;
end;
$function$;

revoke execute on function public.request_voyage_booking(uuid, uuid[], integer, text, jsonb) from public, anon;
grant execute on function public.request_voyage_booking(uuid, uuid[], integer, text, jsonb) to authenticated;

-- Same guard for a re-proposed expired application (body otherwise unchanged from
-- 20260724100000_reactivate_expired_voyage_booking).
create or replace function public.reactivate_expired_voyage_booking(_booking_request_id uuid)
returns table(booking_request_id uuid, booking_status public.voyage_booking_status, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  requester uuid := auth.uid();
  requester_email text;
  v_request public.voyage_booking_requests%rowtype;
  v_leg_ids uuid[];
  v_bookable_leg_count integer;
  v_new_expires_at timestamptz;
begin
  if requester is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v_request
  from public.voyage_booking_requests
  where id = _booking_request_id
  for update;

  if not found then
    raise exception 'Booking request not found' using errcode = '22023';
  end if;

  if v_request.profile_id <> requester then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  if v_request.status <> 'expired' then
    raise exception 'Booking request is not expired' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_request.voyage_id::text, 0));
  perform public.deactivate_past_voyage_bookable_legs();

  select array_agg(link.bookable_leg_id)
  into v_leg_ids
  from public.voyage_booking_request_legs link
  where link.booking_request_id = _booking_request_id;

  if v_leg_ids is null or cardinality(v_leg_ids) = 0 then
    raise exception 'Booking request has no legs' using errcode = '22023';
  end if;

  -- Every original leg must still be open for booking and within its time window.
  select count(*)
  into v_bookable_leg_count
  from public.voyage_bookable_legs leg
  where leg.id = any(v_leg_ids)
    and leg.is_bookable = true
    and public.voyage_leg_is_bookable_now(
      leg.actual_departure_at,
      leg.actual_arrival_at,
      leg.starts_at_window_start,
      leg.ends_at_window_end
    );

  if v_bookable_leg_count <> cardinality(v_leg_ids) then
    raise exception 'legs_unavailable' using errcode = 'BK002';
  end if;

  if public.admin_booking_over_capacity(v_request.voyage_id, v_leg_ids, v_request.party_size, _booking_request_id) then
    raise exception 'legs_unavailable' using errcode = 'BK002';
  end if;

  -- Same duplicate guard as a fresh application: another active place of the same traveller —
  -- their own request, or a guest seat on someone else's — must not already sit on these legs.
  requester_email := lower(nullif(trim(coalesce(
    auth.jwt() ->> 'email',
    (select p.email from public.profiles p where p.id = requester)
  )), ''));

  if public.voyage_leg_booking_conflict_exists(v_leg_ids, requester, requester_email, _booking_request_id) then
    raise exception 'duplicate_leg_booking' using errcode = 'BK001';
  end if;

  v_new_expires_at := timezone('utc', now()) + interval '1 hour';

  update public.voyage_booking_requests
  set status = 'pending_payment',
      expires_at = v_new_expires_at,
      updated_at = timezone('utc', now())
  where id = _booking_request_id;

  booking_request_id := _booking_request_id;
  booking_status := 'pending_payment';
  expires_at := v_new_expires_at;
  return next;
end;
$$;

revoke execute on function public.reactivate_expired_voyage_booking(uuid) from public, anon;
grant execute on function public.reactivate_expired_voyage_booking(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. set_booking_participants: validate the guest list instead of hitting the index
--    (body otherwise identical to 20260721140300_participants_allow_pending_payment)
-- ---------------------------------------------------------------------------

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
  v_guest_email text;
  v_guest_emails text[] := '{}';
  v_guest_count integer := 0;
  v_leg_ids uuid[];
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
  if v_request.status not in ('pending_payment', 'requested', 'waitlisted', 'admin_approved', 'user_confirmed') then
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

  select email into v_lead_email from public.profiles where id = auth.uid();

  select array_agg(link.bookable_leg_id)
  into v_leg_ids
  from public.voyage_booking_request_legs link
  where link.booking_request_id = _booking_request_id;

  -- Validate the whole payload before writing anything: an invalid guest list must not leave
  -- the previous one half-replaced, and must never reach the unique index as a raw error.
  for v_guest in select * from jsonb_array_elements(_participants)
  loop
    v_guest_email := lower(nullif(trim(v_guest ->> 'email'), ''));

    if v_guest_email is null or position('@' in v_guest_email) <= 1 then
      raise exception 'participant_email_invalid';
    end if;
    if v_guest_email = lower(coalesce(v_lead_email, '')) then
      raise exception 'participant_email_is_lead';
    end if;
    if v_guest_email = any(v_guest_emails) then
      raise exception 'participant_email_duplicated';
    end if;
    -- One person, one seat: an invitee who already holds a place on these legs (their own
    -- application, or a guest seat on another booking) cannot be added again here.
    if v_leg_ids is not null
       and public.voyage_leg_booking_conflict_exists(v_leg_ids, null, v_guest_email, _booking_request_id)
    then
      raise exception 'participant_already_booked';
    end if;

    v_guest_emails := v_guest_emails || v_guest_email;
  end loop;

  update public.voyage_booking_requests
  set payment_mode = _payment_mode, updated_at = timezone('utc', now())
  where id = _booking_request_id;

  -- Lead participant (the booker) — already accepted the conditions at booking time.
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
      (select id from public.profiles where lower(email) = lower(trim(v_guest ->> 'email')) limit 1),
      lower(trim(v_guest ->> 'email')),
      nullif(trim(v_guest ->> 'first_name'), ''),
      nullif(trim(v_guest ->> 'last_name'), ''),
      'pending',
      timezone('utc', now()) + interval '7 days'
    );
  end loop;

  -- Admins are told about the guest list only once the application actually exists for them,
  -- i.e. not while it is still sitting behind the payment gate.
  if v_request.status <> 'pending_payment' then
    perform public.enqueue_admin_voyage_booking_notifications(
      _booking_request_id,
      'admin_modified',
      jsonb_build_object('guest_count', v_guest_count, 'payment_mode', _payment_mode)
    );
  end if;

  return query
    select * from public.voyage_booking_participants
    where booking_request_id = _booking_request_id
    order by is_lead desc, created_at asc;
end;
$$;

revoke execute on function public.set_booking_participants(uuid, text, jsonb) from public, anon;
grant execute on function public.set_booking_participants(uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Pending invites actually expire now
-- ---------------------------------------------------------------------------

-- Narrowed to live bookings: a guest still sitting 'pending' on a cancelled/rejected/expired
-- request holds nothing, and decrementing party_size there would only corrupt the historical
-- record of how big the party was.
create or replace function public.expire_pending_booking_participants()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_expired integer := 0;
  v_rec record;
begin
  for v_rec in
    select participant.id, participant.booking_request_id
    from public.voyage_booking_participants participant
    join public.voyage_booking_requests request
      on request.id = participant.booking_request_id
    where participant.status = 'pending'
      and participant.is_lead = false
      and participant.expires_at is not null
      and participant.expires_at < timezone('utc', now())
      and request.status in (
        'pending_payment', 'requested', 'waitlisted', 'admin_approved', 'user_confirmed'
      )
  loop
    update public.voyage_booking_participants
    set status = 'expired', updated_at = timezone('utc', now())
    where id = v_rec.id
      and status = 'pending';

    if not found then
      continue;
    end if;

    -- Free the seat: reduce party size (never below 1).
    update public.voyage_booking_requests
    set party_size = greatest(1, party_size - 1), updated_at = timezone('utc', now())
    where id = v_rec.booking_request_id;

    v_expired := v_expired + 1;
  end loop;

  return v_expired;
end;
$$;

revoke execute on function public.expire_pending_booking_participants() from public, anon, authenticated;
grant execute on function public.expire_pending_booking_participants() to service_role;

select cron.schedule(
  'expire-pending-booking-participants',
  '25 * * * *',
  $$select public.expire_pending_booking_participants();$$
)
where not exists (
  select 1 from cron.job where jobname = 'expire-pending-booking-participants'
);
