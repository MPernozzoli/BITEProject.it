-- Make sync_voyage_bookable_legs baseline-aware.
--
-- The existing function already computes exactly the baseline: it walks the plan
-- from the departure window and knows nothing about actuals. So rather than
-- rewriting its ~480 lines (and its booking reconciliation with it), we rename it
-- untouched to sync_voyage_bookable_legs_plan and wrap it:
--
--   1. run the plan sync as before  -> starts_at_window_* now holds the new plan
--   2. freeze that into baseline_*  -> the floor for earliness absorption
--   3. apply_voyage_schedule()      -> re-derive the effective schedule from the
--                                      actuals, against the fresh baseline
--
-- Step 3 runs with _notify => false: an admin replan already reports itself
-- through the existing plan-change reconciliation in step 1, and re-announcing
-- the same edit as a delay would double up on the traveller.
--
-- The rename is replay-safe: on a fresh database 20260712122816 creates the
-- original body first, and this migration then renames that.

do $$
begin
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'sync_voyage_bookable_legs_plan'
  ) then
    alter function public.sync_voyage_bookable_legs(uuid)
      rename to sync_voyage_bookable_legs_plan;
  end if;
end $$;

revoke execute on function public.sync_voyage_bookable_legs_plan(uuid) from public, anon, authenticated;
grant execute on function public.sync_voyage_bookable_legs_plan(uuid) to service_role;

comment on function public.sync_voyage_bookable_legs_plan(uuid) is
  'Internal: rebuilds the planned leg chain and reconciles bookings. Knows nothing about actuals, so its output is the baseline. Call sync_voyage_bookable_legs instead.';

create or replace function public.sync_voyage_bookable_legs(_voyage_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_affected integer := 0;
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'Only admins can sync voyage booking legs' using errcode = '42501';
  end if;

  v_affected := public.sync_voyage_bookable_legs_plan(_voyage_id);

  update public.voyage_bookable_legs leg
  set baseline_starts_at_window_start = leg.starts_at_window_start,
      baseline_starts_at_window_end   = leg.starts_at_window_end,
      baseline_ends_at_window_start   = leg.ends_at_window_start,
      baseline_ends_at_window_end     = leg.ends_at_window_end
  where leg.voyage_id = _voyage_id;

  perform public.apply_voyage_schedule(_voyage_id, false);

  return v_affected;
end;
$$;

revoke execute on function public.sync_voyage_bookable_legs(uuid) from public, anon;
grant execute on function public.sync_voyage_bookable_legs(uuid) to authenticated;

comment on function public.sync_voyage_bookable_legs(uuid) is
  'Admin replan: rebuilds the plan, freezes it as the new baseline, then re-derives the effective schedule from any recorded actuals.';

-- deactivate_past_voyage_bookable_legs is the cron/RPC sweep that retires legs as
-- time passes. Move it onto the same phase rule so a leg that has actually
-- departed stops being bookable, instead of lingering until its planned date.
create or replace function public.deactivate_past_voyage_bookable_legs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_count integer := 0;
begin
  update public.voyage_bookable_legs leg
  set is_bookable = false
  where leg.is_bookable = true
    and not public.voyage_leg_is_bookable_now(
      leg.actual_departure_at,
      leg.actual_arrival_at,
      leg.starts_at_window_start,
      leg.ends_at_window_end
    );

  get diagnostics affected_count = row_count;

  return affected_count;
end;
$$;

revoke execute on function public.deactivate_past_voyage_bookable_legs() from public, anon, authenticated;
grant execute on function public.deactivate_past_voyage_bookable_legs() to service_role;
