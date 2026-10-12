-- Per-booking extension of the balance deadline, plus a one-off reopening of two bookings.
--
-- The balance deadline (15 days before the traveller's own embarkation leg) has so far been
-- computed live and could not be moved for a single booking: once it passed, the 10-minute
-- expire_unpaid_voyage_booking_balance sweep cancelled the booking and there was no way to give
-- someone a few extra hours without the sweep cancelling them again on its next tick.
--
-- balance_deadline_extended_until is an admin-granted override: the deadline becomes the later
-- of the computed one and this timestamp. Because every consumer reads the deadline through
-- voyage_booking_balance_deadline (the expiry sweep, the balance reminders with their
-- balance_due_at, voyage_booking_full_payment_required), they all honour the extension at once.
-- When it lapses unpaid, the regular sweep cancels the booking again with the usual
-- balance_deadline_missed notifications — no extra cleanup needed.

alter table public.voyage_booking_requests
  add column if not exists balance_deadline_extended_until timestamptz;

comment on column public.voyage_booking_requests.balance_deadline_extended_until is
  'Admin-granted extension of the balance deadline. voyage_booking_balance_deadline returns the later of the computed deadline (15 days before embarkation) and this value.';

create or replace function public.voyage_booking_balance_deadline(_booking_request_id uuid)
returns timestamptz
language sql
stable
set search_path = public, pg_temp
as $$
  select case
    when computed.deadline is null then null
    else greatest(computed.deadline, r.balance_deadline_extended_until)
  end
  from public.voyage_booking_requests r
  cross join lateral (
    select min(leg.starts_at_window_start) - interval '15 days' as deadline
    from public.voyage_booking_request_legs link
    join public.voyage_bookable_legs leg on leg.id = link.bookable_leg_id
    where link.booking_request_id = r.id
      and leg.starts_at_window_start is not null
  ) computed
  where r.id = _booking_request_id;
$$;

-- ---------------------------------------------------------------------------
-- One-off: "Verso l'Atlantico!" — Sanja (2168598b) and Lukas (0a79b8c3) were cancelled by the
-- balance sweep on 2026-10-12 06:30 UTC with the balance unpaid. Admin decision: reopen both
-- with 24 hours to pay the balance (€180 and €162 respectively). Their seats were not taken
-- (no waitlist on those legs). Restored to user_confirmed, the status they held before.
--
-- The first-briefing trigger fires on any transition into user_confirmed and would re-send the
-- briefing email they already received, so it is suspended for this update only.
-- ---------------------------------------------------------------------------

alter table public.voyage_booking_requests disable trigger enqueue_first_voyage_briefing_for_booking_after_write;

update public.voyage_booking_requests
set
  status = 'user_confirmed',
  cancelled_at = null,
  balance_forfeited_at = null,
  balance_deadline_extended_until = timezone('utc', now()) + interval '24 hours',
  admin_notes = coalesce(admin_notes || E'\n\n', '')
    || '[' || to_char(timezone('Europe/Rome', now()), 'YYYY-MM-DD HH24:MI')
    || '] Riattivata dopo la scadenza del saldo: 24 ore per pagare il saldo (fino a '
    || to_char(timezone('Europe/Rome', now() + interval '24 hours'), 'YYYY-MM-DD HH24:MI') || ' ora italiana).'
where id in ('2168598b-19f1-40fe-af99-94f98e460067', '0a79b8c3-f630-494a-805b-1209888e7fbd')
  and status = 'cancelled'
  and balance_forfeited_at is not null;

alter table public.voyage_booking_requests enable trigger enqueue_first_voyage_briefing_for_booking_after_write;

-- Their paid deposits are no longer forfeited.
update public.voyage_booking_deposits
set refund_policy = null, updated_at = timezone('utc', now())
where booking_request_id in ('2168598b-19f1-40fe-af99-94f98e460067', '0a79b8c3-f630-494a-805b-1209888e7fbd')
  and status = 'paid'
  and refund_policy = 'balance_deadline_missed';
