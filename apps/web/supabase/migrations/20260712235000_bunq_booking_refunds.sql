-- Automatic Bunq refunds for terminal booking decisions.
--
-- The Vercel booking-status endpoint computes the refund policy, sends an outgoing Bunq
-- Payment to the original payer alias, then records the refund audit data on the deposit.

alter table public.voyage_booking_deposits
  add column if not exists payer_alias jsonb,
  add column if not exists refund_amount_cents integer not null default 0 check (refund_amount_cents >= 0),
  add column if not exists refund_policy text,
  add column if not exists refund_reference text,
  add column if not exists refund_payment_id bigint;

alter table public.voyage_booking_deposits
  drop constraint if exists voyage_booking_deposits_status_check;

alter table public.voyage_booking_deposits
  add constraint voyage_booking_deposits_status_check
  check (status in ('pending', 'paid', 'partially_refunded', 'refunded', 'failed', 'cancelled'));

create index if not exists voyage_booking_deposits_refund_reference_idx
  on public.voyage_booking_deposits(refund_reference)
  where refund_reference is not null;
