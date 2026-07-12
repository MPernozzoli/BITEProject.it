-- Bank-transfer ("bonifico") as an alternative to the Bunq online payment link.
--
-- Existing rows are all Bunq-link payments (backfilled to 'bunq_link' by the default below).
-- New bank-transfer rows carry no bunq_request_id/share_url and are reconciled by matching
-- their `reference` against incoming account transactions, same as the webhook already does
-- for the online flow's description-embedded reference.

alter table public.voyage_booking_deposits
  add column if not exists payment_method text not null default 'bunq_link'
    check (payment_method in ('bunq_link', 'bank_transfer'));
