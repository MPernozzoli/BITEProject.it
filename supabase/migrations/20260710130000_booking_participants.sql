-- Multi-person bookings: co-travellers ("participants").
--
-- A booking request has one LEAD participant (the booker) plus one row per additional
-- guest. Guests are invited by email, must register on the portal, accept the same
-- conditions and — depending on the payment mode — pay their own deposit. Seats are held
-- immediately at booking time; pending guests that don't complete before expires_at are
-- released by expire_pending_booking_participants().
--
-- Payment modes (chosen by the lead before paying):
--   lead_pays_all  → the lead pays deposit × party_size; guests only accept the conditions.
--   each_pays_own  → the lead pays for one; each guest pays their own deposit on acceptance.

-- --- Schema --------------------------------------------------------------------------

alter table public.voyage_booking_requests
  add column if not exists payment_mode text not null default 'lead_pays_all';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'voyage_booking_requests_payment_mode_check'
  ) then
    alter table public.voyage_booking_requests
      add constraint voyage_booking_requests_payment_mode_check
      check (payment_mode in ('lead_pays_all', 'each_pays_own'));
  end if;
end $$;

create table if not exists public.voyage_booking_participants (
  id uuid primary key default gen_random_uuid(),
  booking_request_id uuid not null references public.voyage_booking_requests(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  email text not null,
  first_name text,
  last_name text,
  is_lead boolean not null default false,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'expired', 'cancelled')),
  conditions_accepted_at timestamptz,
  invite_token text not null default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  invite_sent_at timestamptz,
  accepted_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists voyage_booking_participants_request_idx
  on public.voyage_booking_participants(booking_request_id);
create index if not exists voyage_booking_participants_email_idx
  on public.voyage_booking_participants(lower(email));
create unique index if not exists voyage_booking_participants_request_email_uidx
  on public.voyage_booking_participants(booking_request_id, lower(email));
create unique index if not exists voyage_booking_participants_invite_token_uidx
  on public.voyage_booking_participants(invite_token);

-- Deposits can now be attributed to a specific participant (guest pays their own).
alter table public.voyage_booking_deposits
  add column if not exists participant_id uuid
    references public.voyage_booking_participants(id) on delete set null;

-- --- RLS -----------------------------------------------------------------------------

alter table public.voyage_booking_participants enable row level security;

-- The booking owner (lead) can read every participant on their booking.
drop policy if exists "lead reads booking participants" on public.voyage_booking_participants;
create policy "lead reads booking participants"
  on public.voyage_booking_participants
  for select
  to authenticated
  using (
    exists (
      select 1 from public.voyage_booking_requests r
      where r.id = booking_request_id and r.profile_id = auth.uid()
    )
  );

-- An invited person can read their own participation (matched by profile or email).
drop policy if exists "guest reads own participation" on public.voyage_booking_participants;
create policy "guest reads own participation"
  on public.voyage_booking_participants
  for select
  to authenticated
  using (
    profile_id = auth.uid()
    or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

-- All writes go through the SECURITY DEFINER functions below; no direct client writes.

-- --- RPC: lead sets the guest list + payment mode -------------------------------------

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

  return query
    select * from public.voyage_booking_participants
    where booking_request_id = _booking_request_id
    order by is_lead desc, created_at asc;
end;
$$;

-- --- RPC: invited guest accepts (or declines) participation --------------------------

create or replace function public.accept_booking_participation(_participant_id uuid)
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

  update public.voyage_booking_participants
  set profile_id = auth.uid(),
      status = 'accepted',
      conditions_accepted_at = timezone('utc', now()),
      accepted_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = _participant_id
  returning * into v_row;

  return v_row;
end;
$$;

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

  return v_row;
end;
$$;

-- --- RPC: expire pending guests that never completed ---------------------------------

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
    select id, booking_request_id
    from public.voyage_booking_participants
    where status = 'pending'
      and expires_at is not null
      and expires_at < timezone('utc', now())
  loop
    update public.voyage_booking_participants
    set status = 'expired', updated_at = timezone('utc', now())
    where id = v_rec.id;

    update public.voyage_booking_requests
    set party_size = greatest(1, party_size - 1), updated_at = timezone('utc', now())
    where id = v_rec.booking_request_id;

    v_expired := v_expired + 1;
  end loop;

  return v_expired;
end;
$$;

grant execute on function public.set_booking_participants(uuid, text, jsonb) to authenticated;
grant execute on function public.accept_booking_participation(uuid) to authenticated;
grant execute on function public.decline_booking_participation(uuid) to authenticated;
grant execute on function public.expire_pending_booking_participants() to service_role;
