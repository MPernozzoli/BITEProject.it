-- Closes the gap that let an expired candidature's Bunq payment link stay live and payable
-- after our own deadline, with no way for the money to ever reconcile back to the booking.
--
-- Until now, expire_pending_voyage_booking_payments() only ever flipped the *local* deposit
-- row to 'cancelled' when a booking's payment window closed — it never told Bunq to close the
-- matching request-inquiry. The bunq.me link kept working, so a payer who paid a few minutes
-- late (or whose payment simply hadn't posted yet when the sweep ran) got Bunq's normal
-- "accepted" screen, while both api/payments/bunq/webhook.ts and api/payments/bunq/status.ts
-- only ever settle a deposit that is still 'status = pending' — a 'cancelled' one is invisible
-- to both, forever. The money lands on the account; the booking stays 'expired'.
--
-- The fix is two-sided, and lives partly outside SQL because pg_cron cannot call the Bunq
-- REST API: a new Vercel cron endpoint (api/cron/reconcile-expired-bunq-links.ts) walks
-- recently-cancelled bunq_link deposits and, per item, either revokes the still-unpaid
-- request on Bunq (closing the window for good) or — if Bunq shows it was ACCEPTED before the
-- revoke could land, i.e. exactly the race this migration exists for — calls the function
-- below to settle it exactly as admin_confirm_voyage_booking_payment would.

alter table public.voyage_booking_deposits
  add column if not exists bunq_request_closed_at timestamptz;

comment on column public.voyage_booking_deposits.bunq_request_closed_at is
  'When the expired-link sweep either revoked this deposit''s Bunq request-inquiry or found it '
  'already accepted and reconciled it. Null means the sweep has not processed it yet.';

-- Automated counterpart of admin_confirm_voyage_booking_payment, for a Bunq request the sweep
-- found already ACCEPTED after our own deadline had cancelled the local deposit. Deliberately
-- narrower than the admin RPC: it only ever touches a deposit that is unambiguously *this*
-- Bunq request (matched by id, not by amount typed in by a human), so it needs no admin check —
-- it is driven by the trusted backend job (service_role), the same trust level as
-- settle_voyage_booking_payment itself.
create or replace function public.reconcile_stale_bunq_deposit(
  _deposit_id uuid,
  _amount_eur numeric,
  _reference text
)
returns public.voyage_booking_status
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deposit public.voyage_booking_deposits%rowtype;
  v_request public.voyage_booking_requests%rowtype;
  v_amount_cents integer;
  v_audit text;
  v_status public.voyage_booking_status;
begin
  select * into v_deposit
  from public.voyage_booking_deposits
  where id = _deposit_id
    and payment_method = 'bunq_link'
    and status = 'cancelled'
    and bunq_request_closed_at is null
  for update;

  if not found then
    -- Already handled (or not in the expected state) — safe to no-op, the caller retries blindly.
    return null;
  end if;

  select * into v_request
  from public.voyage_booking_requests
  where id = v_deposit.booking_request_id
  for update;

  if not found then
    raise exception 'booking_not_found' using errcode = '22023';
  end if;

  -- Same guard as admin_confirm_voyage_booking_payment: a cancelled/rejected booking may
  -- already carry a completed refund, so its deposit ledger must not be told money arrived.
  if v_request.status in ('cancelled', 'rejected') then
    update public.voyage_booking_deposits
    set bunq_request_closed_at = timezone('utc', now())
    where id = _deposit_id;
    return v_request.status;
  end if;

  v_amount_cents := round(coalesce(_amount_eur, v_deposit.amount_cents / 100.0) * 100)::integer;

  -- An application that timed out waiting for a payment that had, in fact, already gone
  -- through is put back into 'pending_payment' so settle_voyage_booking_payment below can
  -- promote it normally — mirrors admin_confirm_voyage_booking_payment exactly.
  if v_request.status = 'expired' then
    update public.voyage_booking_requests
    set status = 'pending_payment',
        expires_at = null,
        updated_at = timezone('utc', now())
    where id = v_request.id;
  end if;

  update public.voyage_booking_deposits
  set status = 'paid',
      paid_at = timezone('utc', now()),
      amount_cents = v_amount_cents,
      reference = coalesce(nullif(trim(coalesce(_reference, '')), ''), reference),
      bunq_request_closed_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = _deposit_id;

  v_audit := format(
    '[%s] Pagamento Bunq riconciliato automaticamente: era arrivato dopo la scadenza della '
    'candidatura, ma bunq lo segnava accettato. EUR %s (causale: %s).',
    to_char(timezone('utc', now()), 'YYYY-MM-DD HH24:MI'),
    trim(to_char(v_amount_cents / 100.0, 'FM999999990.00')),
    coalesce(nullif(trim(coalesce(_reference, '')), ''), v_deposit.reference)
  );
  update public.voyage_booking_requests
  set admin_notes = case
        when coalesce(trim(admin_notes), '') = '' then v_audit
        else admin_notes || E'\n' || v_audit
      end,
      updated_at = timezone('utc', now())
  where id = v_request.id;

  v_status := public.settle_voyage_booking_payment(v_request.id);

  perform public.enqueue_voyage_booking_notification(
    v_request.id,
    'payment_received',
    jsonb_build_object(
      'amount_eur', v_amount_cents / 100.0,
      'payment_method', 'bunq_link',
      'payment_reference', coalesce(nullif(trim(coalesce(_reference, '')), ''), v_deposit.reference)
    )
  );

  return v_status;
end;
$$;

revoke execute on function public.reconcile_stale_bunq_deposit(uuid, numeric, text) from public, anon, authenticated;
grant execute on function public.reconcile_stale_bunq_deposit(uuid, numeric, text) to service_role;
