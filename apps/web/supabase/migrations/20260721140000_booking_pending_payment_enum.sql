-- Adds the 'pending_payment' booking status.
--
-- Kept in its own migration on purpose: Postgres allows `alter type ... add value`
-- inside a transaction, but the new label cannot be *used* until that transaction
-- commits. The functions that reference it live in the next migration.

alter type public.voyage_booking_status add value if not exists 'pending_payment' before 'requested';
