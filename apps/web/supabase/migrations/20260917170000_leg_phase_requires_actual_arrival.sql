-- A leg only closes once its arrival is actually logged, not once its window
-- has merely elapsed.
--
-- voyage_leg_phase() used to fall back to 'completed' as soon as
-- ends_at_window_end fell before today, even with no actual_arrival_at
-- recorded. In practice a voyage rarely departs on the exact planned day: if
-- the crew leaves late and nobody has pressed "arriva ora" yet, the leg's
-- window can lapse while the boat is still on it. The phase then flipped to
-- 'completed' on the clock alone, voyage_derived_status() and
-- getCurrentLegIndex() skipped straight to the *next* leg, and the live
-- widget showed a tratta that had not started while the real one — still
-- unfinished — disappeared.
--
-- Example that shipped this bug: Bari -> Santa Maria di Leuca planned for
-- 10-13 September, actually sailed on the 15th. On the 15th the widget
-- showed "Santa Maria di Leuca -> Crotone" instead, because the first leg's
-- window had passed with no actual arrival on file.
--
-- Legs are always sailed in order: a voyage is either travelled end to end or
-- cancelled, so a later leg must never look current while an earlier one is
-- still open. The fix drops the window-elapsed branch entirely — only a
-- recorded actual_arrival_at closes a leg. Until then it stays 'active'
-- (matching apps/web/src/lib/voyage-schedule.ts's getLegPhase, mirrored here).

create or replace function public.voyage_leg_phase(
  _actual_departure_at timestamptz,
  _actual_arrival_at timestamptz,
  _starts_at_window_start timestamptz,
  _ends_at_window_end timestamptz
)
returns text
language sql
stable
set search_path = public
as $$
  select case
    when _actual_arrival_at is not null then 'completed'
    when _actual_departure_at is not null then 'active'
    when _starts_at_window_start is null then 'planned'
    when (timezone('Europe/Rome', _starts_at_window_start))::date <= (timezone('Europe/Rome', now()))::date
      then 'active'
    else 'planned'
  end
$$;

comment on function public.voyage_leg_phase(timestamptz, timestamptz, timestamptz, timestamptz) is
  'Canonical leg phase: planned | active | completed. Only a recorded actual_arrival_at closes a leg — an elapsed window alone never does, so legs stay in order. Mirrored in src/lib/voyage-schedule.ts.';

-- voyages.status is only a cache of voyage_derived_status(); recompute it now
-- so a voyage stuck "completed" purely on the old date-based rule flips back
-- to its real phase immediately, without waiting for the next cron tick.
select public.refresh_all_voyage_statuses();
