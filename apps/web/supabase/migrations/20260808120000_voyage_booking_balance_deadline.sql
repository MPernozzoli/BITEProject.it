-- Deposit now, balance later.
--
-- Until now a paid contribution meant the whole amount, collected in one shot at application
-- time. From now on the first payment collects only a deposit (50% of the contribution, capped
-- at €499 so it always stays payable through the Bunq single-transaction link — see
-- DEPOSIT_PERCENT/DEPOSIT_CAP_EUR in src/lib/booking-deposit.ts), and the remaining balance is
-- due later, before departure. resolveDepositPayer (src/server/bunq/deposit-resolver.ts) already
-- computes and stamps each payer's obligation (contribution_due_cents / contribution_deposit_cents)
-- on whichever entity it resolved as the payer — the booking request itself for a null payer
-- (solo travellers, or a lead before guests are configured / covering the whole lead_pays_all
-- party), the participant row otherwise (an each_pays_own guest, or the lead once they have
-- their own participant row). Existing bookings never get these columns stamped again (nothing
-- re-invokes the resolver on them), so they stay NULL forever and every sweep below ignores
-- them — no backfill needed, no behaviour change for anyone who already paid in full.
--
-- The balance deadline itself — 15 days before the departure of the traveller's OWN embarkation
-- leg, not the voyage's overall start — is computed live from the linked legs, the same join
-- already used by refundPolicyPercent's departureForBooking (src/server/bunq/refunds.ts). It is
-- never stored, so a route change can never leave a stale deadline behind.

-- ---------------------------------------------------------------------------
-- Fix: expire_pending_voyage_booking_payments must not cancel an already-paid booking
--
-- This pre-existing sweep (20260721140100) cancels the whole booking whenever it finds a
-- 'pending' deposit whose short window lapsed (r.expires_at) OR that is simply older than 2 days
-- (d.created_at), for ANY status up to and including user_confirmed. That was safe when a booking
-- had exactly one ever-relevant payment: an abandoned attempt meant it was never legitimately
-- paid at all, so cancelling was correct. It is no longer safe now that a second payment (the
-- balance, or a deposit top-up after a route change) can be armed on a booking that already holds
-- its place — an abandoned balance bank-transfer would otherwise cancel an already-confirmed,
-- already-paid booking days or weeks before the real balance deadline. The exclusion below
-- mirrors src/server/bunq/deposit-resolver.ts's bookingHasEverBeenPaid: once any deposit has
-- ever settled for the booking, a further lingering pending deposit is a retriable top-up, not a
-- gate — expire_unpaid_voyage_booking_balance / expire_unpaid_voyage_booking_guest_shares are the
-- ones that enforce the real (15-day) consequence for that case.
create or replace function public.expire_pending_voyage_booking_payments()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_expired integer := 0;
  v_rec record;
  v_leg_ids uuid[];
begin
  for v_rec in
    -- (a) applications abandoned before any payment was armed, past their grace deadline
    select r.id, r.voyage_id
    from public.voyage_booking_requests r
    where r.status = 'pending_payment'
      and r.expires_at is not null
      and r.expires_at <= timezone('utc', now())
      and not public.voyage_booking_has_paid_deposit(r.id)
    union
    -- (b) a payment was armed but never settled, and the booking never actually cleared its
    -- initial gate (no deposit has ever been paid for it) — see comment above for why an
    -- already-paid booking is deliberately excluded here.
    select distinct r.id, r.voyage_id
    from public.voyage_booking_requests r
    join public.voyage_booking_deposits d
      on d.booking_request_id = r.id
     and d.status = 'pending'
    where r.status in ('pending_payment', 'requested', 'waitlisted', 'admin_approved', 'user_confirmed')
      and (
        (r.expires_at is not null and r.expires_at <= timezone('utc', now()))
        or d.created_at <= timezone('utc', now()) - interval '2 days'
      )
      and not public.voyage_booking_has_paid_deposit(r.id)
  loop
    select array_agg(bookable_leg_id)
    into v_leg_ids
    from public.voyage_booking_request_legs
    where booking_request_id = v_rec.id;

    update public.voyage_booking_requests
    set
      status = 'expired',
      expires_at = null,
      updated_at = timezone('utc', now())
    where id = v_rec.id
      and status = 'pending_payment';

    if found then
      -- Never reviewed by anyone and never paid: retire it silently, no notifications.
      update public.voyage_booking_deposits
      set status = 'cancelled', updated_at = timezone('utc', now())
      where booking_request_id = v_rec.id
        and status = 'pending';

      v_expired := v_expired + 1;
      continue;
    end if;

    update public.voyage_booking_requests
    set
      status = 'cancelled',
      cancelled_at = coalesce(cancelled_at, timezone('utc', now())),
      expires_at = null,
      updated_at = timezone('utc', now())
    where id = v_rec.id
      and status in ('requested', 'waitlisted', 'admin_approved', 'user_confirmed');

    if found then
      update public.voyage_booking_deposits
      set status = 'cancelled', updated_at = timezone('utc', now())
      where booking_request_id = v_rec.id
        and status = 'pending';

      perform public.enqueue_voyage_booking_notification(v_rec.id, 'payment_expired');
      perform public.enqueue_admin_voyage_booking_notifications(
        v_rec.id,
        'admin_cancelled',
        jsonb_build_object('reason', 'payment_expired')
      );
      perform public.promote_waitlisted_voyage_bookings(v_rec.voyage_id, coalesce(v_leg_ids, array[]::uuid[]));

      v_expired := v_expired + 1;
    end if;
  end loop;

  return v_expired;
end;
$$;

revoke execute on function public.expire_pending_voyage_booking_payments() from public, anon, authenticated;
grant execute on function public.expire_pending_voyage_booking_payments() to service_role;

-- A balance/top-up payment left pending on an already-paid booking is now excluded from the
-- sweep above (it never cancels the booking) but the stale deposit row itself would otherwise
-- sit as 'pending' forever, forcing findExistingDeposit's idempotency check to keep reusing an
-- old bunq.me link / bank reference indefinitely. Sweeping those rows to 'cancelled' on the same
-- cadence lets the traveller's next click on "Paga il saldo" mint a fresh one.
create or replace function public.expire_stale_voyage_booking_topup_deposits()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  with stale as (
    select d.id
    from public.voyage_booking_deposits d
    join public.voyage_booking_requests r on r.id = d.booking_request_id
    where d.status = 'pending'
      and r.status in ('requested', 'waitlisted', 'admin_approved', 'user_confirmed')
      and public.voyage_booking_has_paid_deposit(r.id)
      and (
        (r.expires_at is not null and r.expires_at <= timezone('utc', now()))
        or d.created_at <= timezone('utc', now()) - interval '2 days'
      )
  )
  update public.voyage_booking_deposits d
  set status = 'cancelled', updated_at = timezone('utc', now())
  from stale
  where d.id = stale.id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.expire_stale_voyage_booking_topup_deposits() from public, anon, authenticated;
grant execute on function public.expire_stale_voyage_booking_topup_deposits() to service_role;

select cron.schedule(
  'expire-stale-voyage-booking-topup-deposits',
  '*/10 * * * *',
  $$select public.expire_stale_voyage_booking_topup_deposits();$$
)
where not exists (
  select 1 from cron.job where jobname = 'expire-stale-voyage-booking-topup-deposits'
);

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------

alter table public.voyage_booking_requests
  add column if not exists contribution_due_cents integer,
  add column if not exists contribution_deposit_cents integer,
  add column if not exists contribution_due_stamped_at timestamptz,
  add column if not exists balance_forfeited_at timestamptz,
  add column if not exists balance_reminder_sent_at timestamptz;

comment on column public.voyage_booking_requests.contribution_due_cents is
  'Snapshot of the null-payer''s (solo traveller / lead) full contribution, stamped by resolveDepositPayer. NULL for bookings created before the deposit/balance split shipped.';
comment on column public.voyage_booking_requests.contribution_deposit_cents is
  'Snapshot of the null-payer''s required upfront deposit (min(50% of contribution_due_cents, €499)).';
comment on column public.voyage_booking_requests.contribution_due_stamped_at is
  'When the snapshot above was last computed. A route change re-inserts voyage_booking_request_legs with a fresh created_at; if that is later than this timestamp, the snapshot predates the traveller''s current legs and every sweep below skips the booking rather than act on stale numbers.';
comment on column public.voyage_booking_requests.balance_forfeited_at is
  'Set when the booking was cancelled by expire_unpaid_voyage_booking_balance for missing the balance deadline.';

alter table public.voyage_booking_participants
  add column if not exists contribution_due_cents integer,
  add column if not exists contribution_deposit_cents integer,
  add column if not exists contribution_due_stamped_at timestamptz,
  add column if not exists balance_reminder_sent_at timestamptz;

comment on column public.voyage_booking_participants.contribution_due_cents is
  'Snapshot of this participant''s own full contribution when they pay their own share (each_pays_own guest, or a lead with their own participant row), stamped by resolveDepositPayer.';

alter table public.voyage_booking_participants
  drop constraint if exists voyage_booking_participants_status_check;
alter table public.voyage_booking_participants
  add constraint voyage_booking_participants_status_check check (
    status in ('pending', 'accepted', 'declined', 'expired', 'cancelled', 'balance_unpaid')
  );
comment on constraint voyage_booking_participants_status_check on public.voyage_booking_participants is
  'balance_unpaid: an each_pays_own guest whose own balance was not paid by the deadline — their seat is released but the rest of the booking stays active.';

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
      'payment_pending',
      'payment_received',
      'payment_failed',
      'payment_expired',
      'payment_reminder',
      'plan_change_pending',
      'plan_change_auto_accepted',
      'first_briefing',
      'second_briefing',
      'admin_new_booking',
      'admin_cancelled',
      'admin_modified',
      'admin_payment_pending',
      'admin_payment_received',
      'admin_plan_change',
      'user_plan_change_requested',
      'user_plan_change_resolved',
      'balance_reminder',
      'balance_deadline_missed',
      'admin_balance_deadline_missed'
    )
  );

-- ---------------------------------------------------------------------------
-- Balance deadline: 15 days before the traveller's own embarkation leg
-- ---------------------------------------------------------------------------

create or replace function public.voyage_booking_balance_deadline(_booking_request_id uuid)
returns timestamptz
language sql
stable
set search_path = public, pg_temp
as $$
  select min(leg.starts_at_window_start) - interval '15 days'
  from public.voyage_booking_request_legs link
  join public.voyage_bookable_legs leg on leg.id = link.bookable_leg_id
  where link.booking_request_id = _booking_request_id
    and leg.starts_at_window_start is not null;
$$;

comment on function public.voyage_booking_balance_deadline(uuid) is
  'Balance due date: 15 days before the earliest departure among this booking''s own linked legs (the traveller''s embarkation leg, not necessarily the voyage''s overall start). NULL when the legs carry no departure time yet — the sweeps below never act on a NULL deadline.';

-- A route change (respond_voyage_booking_plan_change, accept_proposed_change) re-inserts
-- voyage_booking_request_legs with a fresh created_at but does NOT recompute
-- contribution_due_cents (that formula lives only in TS, deliberately not duplicated here).
-- Without this guard the balance-deadline sweeps would keep comparing paid-so-far against a
-- pre-route-change total forever, for any booking whose accepted change did not happen to
-- require an immediate settlement payment — false cancellations of an already-settled booking
-- are the failure mode this exists to rule out. NULL stamped_at (never stamped) is never fresh.
create or replace function public.voyage_booking_contribution_snapshot_is_fresh(
  _booking_request_id uuid,
  _stamped_at timestamptz
)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select _stamped_at is not null and not exists (
    select 1
    from public.voyage_booking_request_legs link
    where link.booking_request_id = _booking_request_id
      and link.created_at > _stamped_at
  );
$$;

-- ---------------------------------------------------------------------------
-- a) Whole booking lapses: the "primary payer" (the booking owner / lead) missed
--    their own balance deadline.
--
-- A fresh application's very first (deposit) payment always happens before guests can be
-- configured (set_booking_participants requires the booking to already be out of
-- 'pending_payment', which itself requires that first payment) — so that deposit deposit row
-- is always tagged participant_id IS NULL, and it always belongs to whoever the booking owner
-- is. Once guests are configured, the lead gets their own participant row and every later
-- resolveDepositPayer call for them resolves and stamps that row instead. The lead's identity
-- is therefore the union of "participant_id IS NULL" and "participant_id = the lead's row" —
-- both are treated as the same payer below, using whichever contribution_due_cents snapshot is
-- freshest (the participant one, once it exists).
-- ---------------------------------------------------------------------------

create or replace function public.expire_unpaid_voyage_booking_balance()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_expired integer := 0;
  v_rec record;
  v_leg_ids uuid[];
  v_other record;
begin
  for v_rec in
    select
      r.id,
      r.voyage_id,
      lead.id as lead_participant_id,
      coalesce(lead.contribution_due_cents, r.contribution_due_cents) as due_cents
    from public.voyage_booking_requests r
    left join public.voyage_booking_participants lead
      on lead.booking_request_id = r.id and lead.is_lead = true
    where r.status in ('requested', 'waitlisted', 'admin_approved', 'user_confirmed')
      and coalesce(r.is_comped, false) = false
      and coalesce(lead.contribution_due_cents, r.contribution_due_cents) is not null
      and public.voyage_booking_contribution_snapshot_is_fresh(
        r.id, coalesce(lead.contribution_due_stamped_at, r.contribution_due_stamped_at)
      )
      and public.voyage_booking_balance_deadline(r.id) is not null
      and public.voyage_booking_balance_deadline(r.id) <= timezone('utc', now())
      and coalesce((
        select sum(d.amount_cents)
        from public.voyage_booking_deposits d
        where d.booking_request_id = r.id
          and d.status = 'paid'
          and (d.participant_id is null or d.participant_id = lead.id)
      ), 0) < coalesce(lead.contribution_due_cents, r.contribution_due_cents)
  loop
    select array_agg(bookable_leg_id)
    into v_leg_ids
    from public.voyage_booking_request_legs
    where booking_request_id = v_rec.id;

    update public.voyage_booking_requests
    set
      status = 'cancelled',
      cancelled_at = coalesce(cancelled_at, timezone('utc', now())),
      balance_forfeited_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
    where id = v_rec.id
      and status in ('requested', 'waitlisted', 'admin_approved', 'user_confirmed');

    if not found then
      continue;
    end if;

    -- The non-paying lead's own deposit(s) — including the pre-guest-setup null-tagged one, if
    -- any: forfeited, no automatic refund. An admin can still refund at their discretion via
    -- POST /api/bookings/refund-deposit.
    update public.voyage_booking_deposits
    set refund_policy = 'balance_deadline_missed', updated_at = timezone('utc', now())
    where booking_request_id = v_rec.id
      and status = 'paid'
      and (participant_id is null or participant_id = v_rec.lead_participant_id);

    -- Fairness: any other participant who had already paid their own share is not at fault for
    -- the lead's missed balance. Flag their deposit(s) as owed a refund through the existing
    -- pending-refund queue (AdminBookingRefunds.tsx / admin_list_pending_refunds) rather than
    -- penalising them for someone else's missed payment. No Bunq call from here — an admin
    -- resolves it (or the traveller self-serves via the existing IBAN flow).
    for v_other in
      select id, amount_cents
      from public.voyage_booking_deposits
      where booking_request_id = v_rec.id
        and status = 'paid'
        and participant_id is not null
        and participant_id is distinct from v_rec.lead_participant_id
    loop
      update public.voyage_booking_deposits
      set
        refund_pending = true,
        refund_pending_amount_cents = v_other.amount_cents,
        refund_pending_reason = 'other_payer_balance_deadline_missed',
        refund_policy = 'balance_deadline_missed',
        updated_at = timezone('utc', now())
      where id = v_other.id;
    end loop;

    perform public.enqueue_voyage_booking_notification(
      v_rec.id,
      'balance_deadline_missed',
      jsonb_build_object('scope', 'booking')
    );
    perform public.enqueue_admin_voyage_booking_notifications(
      v_rec.id,
      'admin_balance_deadline_missed',
      jsonb_build_object('scope', 'booking')
    );
    perform public.promote_waitlisted_voyage_bookings(v_rec.voyage_id, coalesce(v_leg_ids, array[]::uuid[]));

    v_expired := v_expired + 1;
  end loop;

  return v_expired;
end;
$$;

revoke execute on function public.expire_unpaid_voyage_booking_balance() from public, anon, authenticated;
grant execute on function public.expire_unpaid_voyage_booking_balance() to service_role;

-- ---------------------------------------------------------------------------
-- b) Single guest share lapses: an each_pays_own, non-lead participant missed
--    their own balance. The rest of the booking stays active.
-- ---------------------------------------------------------------------------

create or replace function public.expire_unpaid_voyage_booking_guest_shares()
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
    select p.id as participant_id, p.booking_request_id, p.profile_id as guest_profile_id,
           r.profile_id as lead_profile_id
    from public.voyage_booking_participants p
    join public.voyage_booking_requests r on r.id = p.booking_request_id
    where p.is_lead = false
      and p.status = 'accepted'
      and r.payment_mode = 'each_pays_own'
      and r.status in ('requested', 'waitlisted', 'admin_approved', 'user_confirmed')
      and coalesce(r.is_comped, false) = false
      and p.contribution_due_cents is not null
      and public.voyage_booking_contribution_snapshot_is_fresh(r.id, p.contribution_due_stamped_at)
      and coalesce((
        select sum(d.amount_cents) from public.voyage_booking_deposits d
        where d.booking_request_id = r.id and d.participant_id = p.id and d.status = 'paid'
      ), 0) < p.contribution_due_cents
      and public.voyage_booking_balance_deadline(r.id) is not null
      and public.voyage_booking_balance_deadline(r.id) <= timezone('utc', now())
  loop
    update public.voyage_booking_participants
    set status = 'balance_unpaid', updated_at = timezone('utc', now())
    where id = v_rec.participant_id
      and status = 'accepted';

    if not found then
      continue;
    end if;

    update public.voyage_booking_requests
    set party_size = greatest(1, party_size - 1), updated_at = timezone('utc', now())
    where id = v_rec.booking_request_id;

    -- Forfeited, no automatic refund — same discretionary admin override as the whole-booking case.
    update public.voyage_booking_deposits
    set refund_policy = 'balance_deadline_missed', updated_at = timezone('utc', now())
    where booking_request_id = v_rec.booking_request_id
      and participant_id = v_rec.participant_id
      and status = 'paid';

    -- The lead's copy goes through the shared helper (it always targets the booking owner);
    -- the guest is not the booking owner, so their own copy is inserted directly.
    if v_rec.lead_profile_id is not null then
      perform public.enqueue_voyage_booking_notification(
        v_rec.booking_request_id,
        'balance_deadline_missed',
        jsonb_build_object('scope', 'participant_removed', 'participant_id', v_rec.participant_id)
      );
    end if;
    if v_rec.guest_profile_id is not null and v_rec.guest_profile_id is distinct from v_rec.lead_profile_id then
      insert into public.voyage_booking_notifications (
        booking_request_id, recipient_profile_id, event_type, metadata
      )
      values (
        v_rec.booking_request_id,
        v_rec.guest_profile_id,
        'balance_deadline_missed',
        jsonb_build_object('scope', 'participant', 'participant_id', v_rec.participant_id)
      )
      on conflict (booking_request_id, event_type, recipient_profile_id)
      do update set
        metadata = excluded.metadata,
        queued_at = timezone('utc', now()),
        processed_at = null,
        emailed_at = null,
        push_sent_at = null,
        attempts = 0,
        failed_at = null,
        error_message = null;
    end if;
    perform public.enqueue_admin_voyage_booking_notifications(
      v_rec.booking_request_id,
      'admin_balance_deadline_missed',
      jsonb_build_object('scope', 'participant', 'participant_id', v_rec.participant_id)
    );

    v_expired := v_expired + 1;
  end loop;

  return v_expired;
end;
$$;

revoke execute on function public.expire_unpaid_voyage_booking_guest_shares() from public, anon, authenticated;
grant execute on function public.expire_unpaid_voyage_booking_guest_shares() to service_role;

-- ---------------------------------------------------------------------------
-- Reminder, once, a few days before the balance deadline
-- ---------------------------------------------------------------------------

create or replace function public.enqueue_voyage_booking_balance_reminders()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sent integer := 0;
  v_rec record;
begin
  for v_rec in
    -- Primary payer (booking owner / lead) — see expire_unpaid_voyage_booking_balance for why
    -- the null-tagged pre-guest-setup deposit and the lead's own participant row are the same
    -- payer identity. Skipped once the lead has a participant row AND that row's own reminder
    -- already fired, so this never doubles up with the branch below.
    select
      r.id as booking_request_id,
      r.profile_id,
      lead.id as participant_id,
      coalesce(lead.contribution_due_cents, r.contribution_due_cents) as due_cents,
      public.voyage_booking_balance_deadline(r.id) as deadline
    from public.voyage_booking_requests r
    left join public.voyage_booking_participants lead
      on lead.booking_request_id = r.id and lead.is_lead = true
    where r.status in ('requested', 'waitlisted', 'admin_approved', 'user_confirmed')
      and coalesce(r.is_comped, false) = false
      and coalesce(lead.contribution_due_cents, r.contribution_due_cents) is not null
      and coalesce(lead.balance_reminder_sent_at, r.balance_reminder_sent_at) is null
      and public.voyage_booking_contribution_snapshot_is_fresh(
        r.id, coalesce(lead.contribution_due_stamped_at, r.contribution_due_stamped_at)
      )
      and public.voyage_booking_balance_deadline(r.id) is not null
      and public.voyage_booking_balance_deadline(r.id) <= timezone('utc', now()) + interval '5 days'
      and coalesce((
        select sum(d.amount_cents)
        from public.voyage_booking_deposits d
        where d.booking_request_id = r.id
          and d.status = 'paid'
          and (d.participant_id is null or d.participant_id = lead.id)
      ), 0) < coalesce(lead.contribution_due_cents, r.contribution_due_cents)
    union all
    -- each_pays_own guests, chasing their own share.
    select p.booking_request_id, coalesce(p.profile_id, r.profile_id), p.id,
           p.contribution_due_cents, public.voyage_booking_balance_deadline(r.id)
    from public.voyage_booking_participants p
    join public.voyage_booking_requests r on r.id = p.booking_request_id
    where p.is_lead = false
      and p.status = 'accepted'
      and r.status in ('requested', 'waitlisted', 'admin_approved', 'user_confirmed')
      and coalesce(r.is_comped, false) = false
      and p.contribution_due_cents is not null
      and p.balance_reminder_sent_at is null
      and public.voyage_booking_contribution_snapshot_is_fresh(r.id, p.contribution_due_stamped_at)
      and coalesce((
        select sum(d.amount_cents) from public.voyage_booking_deposits d
        where d.booking_request_id = r.id and d.participant_id = p.id and d.status = 'paid'
      ), 0) < p.contribution_due_cents
      and public.voyage_booking_balance_deadline(r.id) is not null
      and public.voyage_booking_balance_deadline(r.id) <= timezone('utc', now()) + interval '5 days'
  loop
    -- Inserted directly (not via enqueue_voyage_booking_notification, which always targets the
    -- booking owner) because the each_pays_own branch above must reach the guest themselves,
    -- not the lead.
    if v_rec.profile_id is not null then
      insert into public.voyage_booking_notifications (
        booking_request_id, recipient_profile_id, event_type, metadata
      )
      values (
        v_rec.booking_request_id,
        v_rec.profile_id,
        'balance_reminder',
        jsonb_build_object(
          'participant_id', v_rec.participant_id,
          'amount_cents', v_rec.due_cents,
          'balance_due_at', v_rec.deadline,
          'phase', 'balance'
        )
      )
      on conflict (booking_request_id, event_type, recipient_profile_id)
      do update set
        metadata = excluded.metadata,
        queued_at = timezone('utc', now()),
        processed_at = null,
        emailed_at = null,
        push_sent_at = null,
        attempts = 0,
        failed_at = null,
        error_message = null;
    end if;

    if v_rec.participant_id is null then
      update public.voyage_booking_requests
      set balance_reminder_sent_at = timezone('utc', now())
      where id = v_rec.booking_request_id;
    else
      update public.voyage_booking_participants
      set balance_reminder_sent_at = timezone('utc', now())
      where id = v_rec.participant_id;
    end if;

    v_sent := v_sent + 1;
  end loop;

  return v_sent;
end;
$$;

revoke execute on function public.enqueue_voyage_booking_balance_reminders() from public, anon, authenticated;
grant execute on function public.enqueue_voyage_booking_balance_reminders() to service_role;

-- ---------------------------------------------------------------------------
-- Admin listing: acconti forfeited by expire_unpaid_voyage_booking_balance /
-- expire_unpaid_voyage_booking_guest_shares, surfaced next to the pending-refunds queue so an
-- admin can review and, at their discretion, pay one back via POST /api/bookings/refund-deposit
-- (adminPayoutDeposit in src/server/bunq/refunds.ts).
-- ---------------------------------------------------------------------------

create or replace function public.admin_list_forfeited_deposits()
returns table (
  deposit_id uuid,
  booking_request_id uuid,
  voyage_id uuid,
  voyage_name text,
  voyage_name_it text,
  voyage_name_en text,
  traveller_name text,
  traveller_email text,
  amount_cents integer,
  refund_amount_cents integer,
  environment text,
  reference text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'Only admins can list forfeited deposits' using errcode = '42501';
  end if;

  return query
  select
    d.id,
    d.booking_request_id,
    req.voyage_id,
    v.name,
    v.name_it,
    v.name_en,
    p.name,
    p.email,
    d.amount_cents,
    d.refund_amount_cents,
    d.environment,
    d.reference,
    d.updated_at
  from public.voyage_booking_deposits d
  join public.voyage_booking_requests req on req.id = d.booking_request_id
  left join public.voyages v on v.id = req.voyage_id
  left join public.profiles p on p.id = req.profile_id
  where d.refund_policy = 'balance_deadline_missed'
    and d.refund_pending = false
    and d.status in ('paid', 'partially_refunded')
    and coalesce(d.refund_amount_cents, 0) < d.amount_cents
  order by d.updated_at desc;
end;
$$;

revoke execute on function public.admin_list_forfeited_deposits() from public, anon;
grant execute on function public.admin_list_forfeited_deposits() to authenticated;

-- ---------------------------------------------------------------------------
-- Schedules
-- ---------------------------------------------------------------------------

select cron.schedule(
  'expire-unpaid-voyage-booking-balance',
  '*/10 * * * *',
  $$select public.expire_unpaid_voyage_booking_balance();$$
)
where not exists (select 1 from cron.job where jobname = 'expire-unpaid-voyage-booking-balance');

select cron.schedule(
  'expire-unpaid-voyage-booking-guest-shares',
  '*/10 * * * *',
  $$select public.expire_unpaid_voyage_booking_guest_shares();$$
)
where not exists (select 1 from cron.job where jobname = 'expire-unpaid-voyage-booking-guest-shares');

select cron.schedule(
  'enqueue-voyage-booking-balance-reminders',
  '30 8 * * *',
  $$select public.enqueue_voyage_booking_balance_reminders();$$
)
where not exists (select 1 from cron.job where jobname = 'enqueue-voyage-booking-balance-reminders');
