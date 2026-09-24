-- Two changes to how outstanding contributions are chased.
--
-- 1. Deposit deferred to the balance.
--    An admin can confirm a seat whose upfront deposit (acconto) was only partly paid: the
--    booking is marked with deposit_deferred_at and from then on nothing is requested as
--    "deposit" any more — the next payment collects the *whole* outstanding amount as the balance
--    (saldo), with the usual deadline of 15 days before the traveller's embarkation leg
--    (voyage_booking_balance_deadline) and the usual consequence if it is missed
--    (expire_unpaid_voyage_booking_balance). resolveDepositPayer in
--    src/server/bunq/deposit-resolver.ts reads the flag; admin_set_voyage_booking_status lets a
--    deferred booking through the negotiated-deposit gate.
--
-- 2. Balance reminders are repeated, not sent once.
--    enqueue_voyage_booking_balance_reminders used to fire a single email 5 days before the
--    deadline (balance_reminder_sent_at doubled as a "done" flag). Now balance_reminder_sent_at
--    is the *last* reminder: the window opens 14 days before the deadline, a reminder goes out
--    every 3 days, and every day in the last 5 days. The email also carries the amount still
--    outstanding instead of the total contribution.

alter table public.voyage_booking_requests
  add column if not exists deposit_deferred_at timestamptz;

comment on column public.voyage_booking_requests.deposit_deferred_at is
  'Set by an admin who confirmed the seat without the full upfront deposit: the whole outstanding contribution is then collected in one balance payment by the regular balance deadline.';


create or replace function public.admin_set_voyage_booking_status(_booking_request_id uuid, _status voyage_booking_status, _allow_over_capacity boolean default false, _admin_notes text default null::text)
 returns table(booking_request_id uuid, over_capacity boolean)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  booking record;
  leg_ids uuid[];
  previous_status public.voyage_booking_status;
  exceeds_capacity boolean := false;
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'Only admins can update booking status' using errcode = '42501';
  end if;

  select req.*
  into booking
  from public.voyage_booking_requests as req
  where req.id = _booking_request_id
  for update;

  if booking.id is null then
    raise exception 'Booking request not found' using errcode = '22023';
  end if;

  if _status in ('admin_approved', 'user_confirmed') then
    if exists (
      select 1
      from public.voyage_booking_deposits as deposit
      where deposit.booking_request_id = _booking_request_id
        and deposit.status = 'pending'
    ) then
      raise exception 'Booking has a pending contribution payment' using errcode = '22023';
    end if;

    -- The gap the payment-gate migration closed: previously a booking with *no* deposit row
    -- at all sailed straight through the check above.
    if not public.voyage_booking_has_paid_deposit(_booking_request_id)
       and not coalesce(booking.is_comped, false)
    then
      raise exception 'Booking has no paid contribution' using errcode = '22023';
    end if;

    -- A contribution/workaway negotiation must be resolved (accepted or never started) before
    -- the booking can move forward — never mid pending_admin_review/pending_user_approval.
    if booking.contribution_proposal_status in ('pending_admin_review', 'pending_user_approval') then
      raise exception 'Booking has an unresolved contribution/workaway proposal' using errcode = '22023';
    end if;

    -- Once accepted, the negotiated variable balance is due before approval — same spirit as
    -- the fixed-deposit check above, applied to the resolved amount instead of the default one.
    -- Skipped when an admin deferred the deposit to the balance: the rest is then chased by the
    -- balance deadline instead.
    if booking.contribution_proposal_status = 'accepted'
       and coalesce(booking.contribution_resolved_variable_cents, 0) > 0
       and booking.deposit_deferred_at is null
       and not public.voyage_booking_negotiated_balance_paid(_booking_request_id)
    then
      raise exception 'Booking has an unpaid negotiated contribution balance' using errcode = '22023';
    end if;
  end if;

  previous_status := booking.status;
  perform pg_advisory_xact_lock(hashtextextended(booking.voyage_id::text, 0));

  select array_agg(link.bookable_leg_id)
  into leg_ids
  from public.voyage_booking_request_legs as link
  where link.booking_request_id = _booking_request_id;

  if _status in ('admin_approved', 'user_confirmed') then
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

  update public.voyage_booking_requests as req
  set
    status = _status,
    admin_notes = coalesce(nullif(trim(_admin_notes), ''), req.admin_notes),
    confirmed_at = case when _status = 'user_confirmed' then timezone('utc', now()) else req.confirmed_at end,
    cancelled_at = case when _status = 'cancelled' then timezone('utc', now()) else req.cancelled_at end
  where req.id = _booking_request_id;

  if _status in ('admin_approved', 'user_confirmed', 'cancelled', 'rejected') and previous_status is distinct from _status then
    perform public.enqueue_voyage_booking_notification(_booking_request_id, _status::text);
  end if;

  if previous_status in ('admin_approved', 'user_confirmed')
    and _status not in ('admin_approved', 'user_confirmed')
  then
    perform public.promote_waitlisted_voyage_bookings(booking.voyage_id, leg_ids);
  end if;

  booking_request_id := _booking_request_id;
  over_capacity := exceeds_capacity;
  return next;
end;
$function$;


create or replace function public.voyage_booking_balance_reminder_due(
  _deadline timestamptz,
  _last_sent_at timestamptz
)
returns boolean
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  -- Window opens 14 days before the deadline; one reminder every 3 days, then one a day in the
  -- last 5 days. The cron runs once a day, so the gaps are a few hours short of 3 days / 1 day
  -- to stay aligned with the daily tick instead of drifting by one run.
  select _deadline is not null
    and _deadline <= timezone('utc', now()) + interval '14 days'
    and (
      _last_sent_at is null
      or _last_sent_at <= timezone('utc', now()) - case
        when _deadline <= timezone('utc', now()) + interval '5 days' then interval '20 hours'
        else interval '68 hours'
      end
    );
$function$;


create or replace function public.enqueue_voyage_booking_balance_reminders()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_sent integer := 0;
  v_rec record;
begin
  for v_rec in
    -- Primary payer (booking owner / lead) — see expire_unpaid_voyage_booking_balance for why
    -- the null-tagged pre-guest-setup deposit and the lead's own participant row are the same
    -- payer identity.
    select *
    from (
      select
        r.id as booking_request_id,
        r.profile_id,
        lead.id as participant_id,
        coalesce(lead.contribution_due_cents, r.contribution_due_cents) as due_cents,
        coalesce((
          select sum(d.amount_cents)
          from public.voyage_booking_deposits d
          where d.booking_request_id = r.id
            and d.status = 'paid'
            and (d.participant_id is null or d.participant_id = lead.id)
        ), 0) as paid_cents,
        public.voyage_booking_balance_deadline(r.id) as deadline,
        case when lead.id is null then r.balance_reminder_sent_at else lead.balance_reminder_sent_at end as last_sent_at
      from public.voyage_booking_requests r
      left join public.voyage_booking_participants lead
        on lead.booking_request_id = r.id and lead.is_lead = true
      where r.status in ('requested', 'waitlisted', 'admin_approved', 'user_confirmed')
        and coalesce(r.is_comped, false) = false
        and coalesce(lead.contribution_due_cents, r.contribution_due_cents) is not null
        and public.voyage_booking_contribution_snapshot_is_fresh(
          r.id, coalesce(lead.contribution_due_stamped_at, r.contribution_due_stamped_at)
        )
      union all
      -- each_pays_own guests, chasing their own share.
      select
        p.booking_request_id,
        coalesce(p.profile_id, r.profile_id),
        p.id,
        p.contribution_due_cents,
        coalesce((
          select sum(d.amount_cents) from public.voyage_booking_deposits d
          where d.booking_request_id = r.id and d.participant_id = p.id and d.status = 'paid'
        ), 0),
        public.voyage_booking_balance_deadline(r.id),
        p.balance_reminder_sent_at
      from public.voyage_booking_participants p
      join public.voyage_booking_requests r on r.id = p.booking_request_id
      where p.is_lead = false
        and p.status = 'accepted'
        and r.status in ('requested', 'waitlisted', 'admin_approved', 'user_confirmed')
        and coalesce(r.is_comped, false) = false
        and p.contribution_due_cents is not null
        and public.voyage_booking_contribution_snapshot_is_fresh(r.id, p.contribution_due_stamped_at)
    ) candidates
    where candidates.paid_cents < candidates.due_cents
      and public.voyage_booking_balance_reminder_due(candidates.deadline, candidates.last_sent_at)
  loop
    -- Inserted directly (not via enqueue_voyage_booking_notification, which always targets the
    -- booking owner) because the each_pays_own branch above must reach the guest themselves,
    -- not the lead. The conflict branch re-arms the same row, and the new queued_at makes it a
    -- distinct email for the Resend idempotency key.
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
          'amount_cents', v_rec.due_cents - v_rec.paid_cents,
          'total_due_cents', v_rec.due_cents,
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
$function$;

revoke execute on function public.enqueue_voyage_booking_balance_reminders() from public, anon, authenticated;
grant execute on function public.enqueue_voyage_booking_balance_reminders() to service_role;
