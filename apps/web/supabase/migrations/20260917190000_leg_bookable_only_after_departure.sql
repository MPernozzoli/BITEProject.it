-- A leg stays bookable until the admin explicitly records a departure.  The
-- old rule flipped a leg to "not bookable" as soon as its scheduled window
-- started, even without anyone pressing "parti ora".  In practice this meant
-- nobody could join from a port whose date had arrived but that we had not
-- actually left yet.
--
-- voyage_leg_phase() stays untouched — it still returns "active" for the
-- voyage-status cache and the live widget.  Only the bookability gate changes:
-- actual_departure_at being set is now the sole reason a leg closes for
-- bookings.

create or replace function public.voyage_leg_is_bookable_now(
  _actual_departure_at timestamptz,
  _actual_arrival_at timestamptz,
  _starts_at_window_start timestamptz,
  _ends_at_window_end timestamptz
)
returns boolean
language sql
stable
set search_path = public
as $$
  -- A leg is bookable as long as nobody has pressed "parti ora" yet.
  -- The arrival/departure parameters are kept in the signature for backwards
  -- compatibility but only departure matters for the bookability decision.
  select _actual_departure_at is null
$$;

comment on function public.voyage_leg_is_bookable_now(timestamptz, timestamptz, timestamptz, timestamptz) is
  'Bookability gate: a leg is open for bookings until the admin records a departure (actual_departure_at).  Mirrored in src/lib/voyage-schedule.ts isLegBookableNow.';

-- Recompute the cached is_bookable flag on all live legs so the new rule
-- takes effect immediately — legs whose window started but that have not
-- departed will re-open for bookings.
update public.voyage_bookable_legs leg
set is_bookable = coalesce(
  (select v.booking_enabled from public.voyages v where v.id = leg.voyage_id),
  false
) and public.voyage_leg_is_bookable_now(
  leg.actual_departure_at,
  leg.actual_arrival_at,
  leg.starts_at_window_start,
  leg.ends_at_window_end
),
updated_at = timezone('utc', now())
where leg.is_bookable is distinct from (
  coalesce(
    (select v.booking_enabled from public.voyages v where v.id = leg.voyage_id),
    false
  ) and public.voyage_leg_is_bookable_now(
    leg.actual_departure_at,
    leg.actual_arrival_at,
    leg.starts_at_window_start,
    leg.ends_at_window_end
  )
);
