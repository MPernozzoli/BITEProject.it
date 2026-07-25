-- Manual payment confirmation: an admin can mark a booking's contribution as received when the
-- automated matcher could not do it on its own.
--
-- Why this is needed: settlement is entirely automatic today (Bunq webhook / status poller ->
-- deposit 'paid' -> settle_voyage_booking_payment), and it matches an incoming bank transfer to a
-- deposit by its reference. A traveller who pays by bonifico but types the wrong causale — or who
-- pays outside the payment dialog altogether, so no deposit row ever existed — is invisible to
-- that matcher: the money is on the account, the application still times out and dies in
-- 'expired'. The only recovery was to hand-write SQL. This gives the admin a supported path.
--
-- It deliberately reuses the same choke point as every automatic settlement
-- (settle_voyage_booking_payment) instead of touching statuses directly, so a manually confirmed
-- payment promotes the booking through exactly the same rules — and fires the same
-- notifications — as one confirmed by the bank webhook.

-- 'manual' is a third payment method rather than a flag on 'bank_transfer': the distinction is
-- the audit trail. It says a human asserted the money arrived, which the refund path must know —
-- a manual deposit carries no bunq_request_id and usually no matchable reference, so
-- refundBookingDeposits cannot recover the payer's IBAN from it and correctly falls back to the
-- refund_pending (handle it by hand) branch instead of silently refunding nothing.
alter table public.voyage_booking_deposits
  drop constraint if exists voyage_booking_deposits_payment_method_check;
alter table public.voyage_booking_deposits
  add constraint voyage_booking_deposits_payment_method_check
  check (payment_method = any (array['bunq_link'::text, 'bank_transfer'::text, 'manual'::text]));

create or replace function public.admin_confirm_voyage_booking_payment(
  _booking_request_id uuid,
  _amount_eur numeric,
  _reference text default null,
  _participant_id uuid default null,
  _admin_note text default null
)
returns table (
  booking_request_id uuid,
  booking_status public.voyage_booking_status,
  deposit_id uuid,
  amount_cents integer,
  reused_pending_deposit boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.voyage_booking_requests%rowtype;
  v_amount_cents integer;
  v_party_size integer;
  v_reference text;
  v_environment text;
  v_pending public.voyage_booking_deposits%rowtype;
  v_deposit public.voyage_booking_deposits%rowtype;
  v_reused boolean := false;
  v_status public.voyage_booking_status;
  v_audit text;
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'Only admins can confirm payments' using errcode = '42501';
  end if;

  v_amount_cents := round(coalesce(_amount_eur, 0) * 100)::integer;
  if v_amount_cents <= 0 then
    raise exception 'amount_must_be_positive' using errcode = '22023';
  end if;

  select * into v_request
  from public.voyage_booking_requests
  where id = _booking_request_id
  for update;

  if not found then
    raise exception 'Booking request not found' using errcode = '22023';
  end if;

  -- Refusing these two is the guard against resurrecting a booking whose money has already been
  -- given back: a cancelled/rejected booking may carry a completed refund, and re-confirming a
  -- payment on it would make the deposit ledger claim funds that are no longer held.
  if v_request.status in ('cancelled', 'rejected') then
    raise exception 'booking_not_active' using errcode = '22023';
  end if;

  if _participant_id is not null and not exists (
    select 1
    from public.voyage_booking_participants participant
    where participant.id = _participant_id
      and participant.booking_request_id = _booking_request_id
  ) then
    raise exception 'participant_not_found' using errcode = '22023';
  end if;

  -- An application that timed out waiting for a transfer that had, in fact, already been sent is
  -- put back into 'pending_payment' so the settlement path below can promote it normally. Safe
  -- without re-checking capacity: settlement lands it in 'requested', and a candidature holds no
  -- seat (see 20260717143112) — the seat check happens later, at approval.
  if v_request.status = 'expired' then
    update public.voyage_booking_requests
    set status = 'pending_payment',
        expires_at = null,
        updated_at = timezone('utc', now())
    where id = _booking_request_id
    returning * into v_request;
  end if;

  -- Mirrors the resolver's coveredPersons: only a lead paying for everyone covers the whole
  -- party; a named participant, or an 'each_pays_own' booking, settles a single share.
  v_party_size := greatest(1, coalesce(v_request.party_size, 1));
  if _participant_id is not null or coalesce(v_request.payment_mode, 'lead_pays_all') <> 'lead_pays_all' then
    v_party_size := 1;
  end if;

  -- Deposits are read back per environment (refunds.ts filters on it), so a manual row must land
  -- in the same one the booking's other deposits used; 'production' is the only sane default for
  -- money that actually arrived.
  select deposit.environment into v_environment
  from public.voyage_booking_deposits deposit
  where deposit.booking_request_id = _booking_request_id
  order by deposit.created_at desc
  limit 1;
  v_environment := coalesce(v_environment, 'production');

  v_reference := nullif(trim(coalesce(_reference, '')), '');

  -- Settle the payer's own armed-but-unsettled deposit when there is one, instead of adding a
  -- second row: paidDepositTotalEur sums every 'paid' deposit for a payer, so a duplicate would
  -- overstate what was received and wrongly zero out a later route-change delta.
  select * into v_pending
  from public.voyage_booking_deposits deposit
  where deposit.booking_request_id = _booking_request_id
    and deposit.status = 'pending'
    and deposit.participant_id is not distinct from _participant_id
  order by deposit.created_at desc
  limit 1
  for update;
  v_reused := found;

  if v_reused then
    update public.voyage_booking_deposits
    set status = 'paid',
        paid_at = timezone('utc', now()),
        updated_at = timezone('utc', now()),
        amount_cents = v_amount_cents,
        per_person_cents = (v_amount_cents / v_party_size)::integer,
        party_size = v_party_size,
        -- Keep the original causale when the admin did not supply one: it is still the string the
        -- payer was asked to use, and refunds try to find the incoming payment by it.
        reference = coalesce(v_reference, reference),
        payment_method = 'manual'
    where id = v_pending.id
    returning * into v_deposit;
  else
    insert into public.voyage_booking_deposits (
      booking_request_id,
      participant_id,
      environment,
      per_person_cents,
      party_size,
      amount_cents,
      currency,
      status,
      reference,
      payment_method,
      paid_at
    )
    values (
      _booking_request_id,
      _participant_id,
      v_environment,
      (v_amount_cents / v_party_size)::integer,
      v_party_size,
      v_amount_cents,
      'EUR',
      'paid',
      coalesce(v_reference, 'MAN-' || upper(substring(_booking_request_id::text, 1, 8))),
      'manual',
      timezone('utc', now())
    )
    returning * into v_deposit;
  end if;

  -- Appended, not replaced: this is a ledger of who vouched for what, and it must survive the
  -- next admin note.
  v_audit := format(
    '[%s] Pagamento confermato manualmente: EUR %s (causale: %s).%s',
    to_char(timezone('utc', now()), 'YYYY-MM-DD HH24:MI'),
    trim(to_char(v_amount_cents / 100.0, 'FM999999990.00')),
    v_deposit.reference,
    coalesce(' ' || nullif(trim(coalesce(_admin_note, '')), ''), '')
  );
  update public.voyage_booking_requests
  set admin_notes = case
        when coalesce(trim(admin_notes), '') = '' then v_audit
        else admin_notes || E'\n' || v_audit
      end,
      updated_at = timezone('utc', now())
  where id = _booking_request_id;

  v_status := public.settle_voyage_booking_payment(_booking_request_id);

  perform public.enqueue_voyage_booking_notification(
    _booking_request_id,
    'payment_received',
    jsonb_build_object(
      'amount_eur', v_amount_cents / 100.0,
      'payment_method', 'manual',
      'payment_reference', v_deposit.reference
    )
  );

  booking_request_id := _booking_request_id;
  booking_status := v_status;
  deposit_id := v_deposit.id;
  amount_cents := v_amount_cents;
  reused_pending_deposit := v_reused;
  return next;
end;
$$;

revoke execute on function public.admin_confirm_voyage_booking_payment(uuid, numeric, text, uuid, text) from public, anon;
grant execute on function public.admin_confirm_voyage_booking_payment(uuid, numeric, text, uuid, text) to authenticated;
