-- A booking email must survive a transient failure.
--
-- dispatch-voyage-booking-notifications only ever looked at rows with `failed_at is null`, and
-- it stamps failed_at on *any* error from send-transactional-email. So one bad minute — the
-- duplicate unsubscribe-token bug of 2026-07-21, an auth blip, a Resend hiccup — silently and
-- permanently destroyed that notification: the traveller never learned that their contribution
-- was due, received, or approved, and nothing in the system ever tried again. The production
-- queue currently holds 15 such rows, including four 'requested' and two 'payment_pending'.
--
-- With an attempt counter the dispatcher can pick a failed row back up (see the matching
-- change in the edge function: retried after 15 minutes, up to 5 attempts). Retries are safe
-- against double delivery because the Resend idempotency key is derived from the row id plus
-- queued_at, both unchanged by a retry — so a send that actually landed before the error is
-- deduplicated by Resend rather than sent twice.

alter table public.voyage_booking_notifications
  add column if not exists attempts integer not null default 0;

comment on column public.voyage_booking_notifications.attempts is
  'Failed dispatch attempts. The dispatcher retries a failed row until this reaches 5.';

-- Existing failures are archaeology: bookings from days ago, some already cancelled or
-- rejected since. Retrying them would email people about a decision they have long since been
-- told about by other means. Burn their attempts so only new failures are retried.
update public.voyage_booking_notifications
set attempts = 5
where failed_at is not null
  and attempts = 0;

-- The 6-hourly bank-transfer reminder re-arms its single row rather than inserting a new one;
-- each nudge is a new event, so it gets the retry budget back too. Body otherwise identical to
-- 20260721150000.
create or replace function public.enqueue_voyage_booking_payment_reminders()
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
    select
      d.id as deposit_id,
      d.booking_request_id,
      d.reference,
      d.amount_cents,
      r.profile_id,
      r.expires_at
    from public.voyage_booking_deposits d
    join public.voyage_booking_requests r on r.id = d.booking_request_id
    where d.status = 'pending'
      and d.payment_method = 'bank_transfer'
      and r.profile_id is not null
      and r.status in ('pending_payment', 'requested', 'waitlisted', 'admin_approved', 'user_confirmed')
      -- Still inside the window: chasing a payment we are about to cancel is just noise.
      and (r.expires_at is null or r.expires_at > timezone('utc', now()))
      -- Give the payer a few hours before the first nudge, then every 6h.
      and coalesce(d.last_reminder_at, d.created_at) <= timezone('utc', now()) - interval '6 hours'
  loop
    insert into public.voyage_booking_notifications (
      booking_request_id, recipient_profile_id, event_type, metadata
    )
    values (
      v_rec.booking_request_id,
      v_rec.profile_id,
      'payment_reminder',
      jsonb_build_object(
        'payment_method', 'bank_transfer',
        'reference', v_rec.reference,
        'amount_cents', v_rec.amount_cents,
        'payment_expires_at', v_rec.expires_at
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

    update public.voyage_booking_deposits
    set last_reminder_at = timezone('utc', now()), updated_at = timezone('utc', now())
    where id = v_rec.deposit_id;

    v_sent := v_sent + 1;
  end loop;

  return v_sent;
end;
$$;

revoke execute on function public.enqueue_voyage_booking_payment_reminders() from public, anon, authenticated;
grant execute on function public.enqueue_voyage_booking_payment_reminders() to service_role;
