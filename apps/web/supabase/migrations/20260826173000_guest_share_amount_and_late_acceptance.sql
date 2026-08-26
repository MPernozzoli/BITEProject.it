-- Two holes in the guest-share work from 20260817160000/20260817170000.
--
-- 1. WRONG AMOUNT ON BOOKINGS THAT NEVER NEGOTIATED.
--    Both new read paths computed a guest's share as `2000 + contribution_resolved_variable_cents`.
--    That is only true once a negotiation has been ACCEPTED. On an ordinary each_pays_own booking
--    the resolved column is null, so the expression collapsed to €20 — the fixed minimum alone,
--    with the whole mileage-based variable silently missing. A guest who had merely paid their
--    deposit therefore read as "quota versata", and the party panel told everyone the group was
--    settled when it was not.
--    SQL cannot recompute the mileage formula (it lives in booking-deposit.ts), but it does not
--    need to: resolveDepositPayer already stamps the authoritative figure on the participant row
--    as contribution_due_cents. So: use the negotiated total when a negotiation was accepted, and
--    that stamp otherwise — null until the payment layer has computed it, which reads honestly as
--    "not known yet" instead of a confidently wrong number.
--
-- 2. GUESTS WHO ACCEPT AFTER THE AMOUNT WAS AGREED WERE NEVER CHASED.
--    arm_voyage_booking_guest_shares only touches guests already 'accepted'. An invitee who
--    accepted later — the common case, since the booker applies, pays and gets reviewed while the
--    invites are still out — got no share_payment_due_at at all. They could still pay, but no
--    deadline existed, so notify_leads_of_overdue_guest_shares would never look at them and the
--    booker would never be asked to decide. The window is now opened at acceptance too, whenever
--    the booking's negotiation has already resolved.

-- ---------------------------------------------------------------------------
-- 1. One definition of "what this guest owes for themselves"
-- ---------------------------------------------------------------------------

create or replace function public.voyage_booking_guest_share_due_cents(
  _booking_request_id uuid,
  _participant_id uuid
)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    -- Nothing of their own to pay: they are the booker, or the booker covers the party.
    when p.is_lead or r.payment_mode is distinct from 'each_pays_own' then null
    -- 2000 = CONTRIBUTION_FIXED_MINIMUM_EUR in cents. The agreed variable is per person, so this
    -- is one guest's whole obligation.
    when r.contribution_proposal_status = 'accepted'
      then 2000 + coalesce(r.contribution_resolved_variable_cents, 0)
    -- No negotiation: the mileage formula is TypeScript, and resolveDepositPayer has already
    -- stamped its result here. Null until they start a payment — better than a wrong figure.
    else p.contribution_due_cents
  end
  from public.voyage_booking_participants p
  join public.voyage_booking_requests r on r.id = p.booking_request_id
  where p.id = _participant_id
    and p.booking_request_id = _booking_request_id;
$$;

comment on function public.voyage_booking_guest_share_due_cents(uuid, uuid) is
  'What one guest owes for themselves on an each_pays_own booking: the negotiated per-person total once a proposal was accepted, otherwise the authoritative figure resolveDepositPayer stamped on their row. Null when they owe nothing of their own, or when nothing has computed it yet. Internal helper — never granted to client roles.';

revoke execute on function public.voyage_booking_guest_share_due_cents(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Both read paths use it
-- ---------------------------------------------------------------------------

create or replace function public.get_booking_party_overview(_booking_request_id uuid)
returns table (
  participant_id uuid,
  first_name text,
  last_name text,
  email text,
  is_lead boolean,
  status text,
  share_due_cents integer,
  share_paid_cents integer,
  share_payment_due_at timestamptz,
  is_me boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    p.id,
    p.first_name,
    p.last_name,
    p.email,
    p.is_lead,
    p.status,
    public.voyage_booking_guest_share_due_cents(r.id, p.id) as share_due_cents,
    coalesce((
      select sum(d.amount_cents)::integer
      from public.voyage_booking_deposits d
      where d.booking_request_id = r.id and d.participant_id = p.id and d.status = 'paid'
    ), 0) as share_paid_cents,
    p.share_payment_due_at,
    (p.profile_id = auth.uid() or lower(p.email) = lower(coalesce(auth.jwt() ->> 'email', ''))) as is_me
  from public.voyage_booking_participants p
  join public.voyage_booking_requests r on r.id = p.booking_request_id
  where p.booking_request_id = _booking_request_id
    -- Caller must be on this booking: its owner, or one of its participants.
    and (
      r.profile_id = auth.uid()
      or public.has_role(auth.uid(), 'admin'::public.app_role)
      or exists (
        select 1
        from public.voyage_booking_participants me
        where me.booking_request_id = r.id
          and (
            me.profile_id = auth.uid()
            or lower(me.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
          )
      )
    )
  order by p.is_lead desc, p.created_at asc;
$$;

revoke execute on function public.get_booking_party_overview(uuid) from public, anon;
grant execute on function public.get_booking_party_overview(uuid) to authenticated;

drop function if exists public.get_my_participations();

create or replace function public.get_my_participations()
returns table (
  participant_id uuid,
  booking_request_id uuid,
  status text,
  is_lead boolean,
  voyage_id uuid,
  voyage_name text,
  voyage_name_it text,
  voyage_name_en text,
  party_size integer,
  payment_mode text,
  requires_payment boolean,
  deposit_paid boolean,
  expires_at timestamptz,
  negotiation_open boolean,
  share_due_cents integer,
  share_paid_cents integer,
  share_payment_due_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    p.id,
    p.booking_request_id,
    p.status,
    p.is_lead,
    r.voyage_id,
    v.name,
    v.name_it,
    v.name_en,
    r.party_size,
    r.payment_mode,
    (r.payment_mode = 'each_pays_own' and p.is_lead = false) as requires_payment,
    exists (
      select 1 from public.voyage_booking_deposits d
      where d.booking_request_id = r.id and d.participant_id = p.id and d.status = 'paid'
    ) as deposit_paid,
    p.expires_at,
    public.voyage_booking_negotiation_open(r.id) as negotiation_open,
    public.voyage_booking_guest_share_due_cents(r.id, p.id) as share_due_cents,
    coalesce((
      select sum(d.amount_cents)::integer
      from public.voyage_booking_deposits d
      where d.booking_request_id = r.id and d.participant_id = p.id and d.status = 'paid'
    ), 0) as share_paid_cents,
    p.share_payment_due_at
  from public.voyage_booking_participants p
  join public.voyage_booking_requests r on r.id = p.booking_request_id
  join public.voyages v on v.id = r.voyage_id
  where p.is_lead = false
    and (
      p.profile_id = auth.uid()
      or lower(p.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
  order by p.created_at desc;
$$;

revoke execute on function public.get_my_participations() from public, anon;
grant execute on function public.get_my_participations() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Accepting after the amount is agreed opens the same two-day window
-- ---------------------------------------------------------------------------

create or replace function public.accept_booking_participation(
  _participant_id uuid,
  _candidate_info jsonb default '{}'::jsonb
)
returns public.voyage_booking_participants
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.voyage_booking_participants%rowtype;
  v_request public.voyage_booking_requests%rowtype;
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

  select * into v_request
  from public.voyage_booking_requests
  where id = v_row.booking_request_id;

  update public.voyage_booking_participants
  set profile_id = auth.uid(),
      status = 'accepted',
      candidate_info = case
        when jsonb_typeof(coalesce(_candidate_info, '{}'::jsonb)) = 'object' then coalesce(_candidate_info, '{}'::jsonb)
        else '{}'::jsonb
      end,
      conditions_accepted_at = timezone('utc', now()),
      accepted_at = timezone('utc', now()),
      -- arm_voyage_booking_guest_shares only reaches guests who had already accepted when the
      -- amount was agreed. Someone accepting afterwards gets their own window here, so the
      -- overdue sweep can see them and the booker still gets asked to decide.
      share_payment_due_at = case
        when v_request.payment_mode = 'each_pays_own'
         and v_request.contribution_proposal_status = 'accepted'
          then timezone('utc', now()) + interval '2 days'
        else share_payment_due_at
      end,
      updated_at = timezone('utc', now())
  where id = _participant_id
  returning * into v_row;

  update public.voyage_booking_requests request
  set profile_id = auth.uid(),
      candidate_info = case
        when jsonb_typeof(coalesce(_candidate_info, '{}'::jsonb)) = 'object' then coalesce(_candidate_info, '{}'::jsonb)
        else request.candidate_info
      end,
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

revoke execute on function public.accept_booking_participation(uuid, jsonb) from public, anon;
grant execute on function public.accept_booking_participation(uuid, jsonb) to authenticated;
