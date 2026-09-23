-- Voyage waypoint aliasing.
--
-- A route correction can skip a planned stop in favour of a different real
-- stop (an 'added' narrative waypoint from insert_voyage_leg_correction_stops
-- — see 20260917120000). Until now, set_voyage_waypoint_actual_status handled
-- that by stamping a synthetic "pass-through" actual (arrival = departure =
-- correction time) directly on the skipped waypoint, purely so the schedule
-- would not stay stuck waiting for an arrival that would never come.
--
-- That synthetic timestamp is wrong whenever the boat has actually arrived at
-- the real stop but not yet left it: it tells the schedule the skipped
-- waypoint was both reached and departed at correction time, when in reality
-- the crew is still there, under a different name, waiting to record
-- "Parti ora". alias_of_waypoint_id fixes this by making the skipped waypoint
-- share its actuals with the real one instead of inventing its own: whichever
-- one gets an arrival or departure recorded, the other picks it up.
--
-- This keeps the "Arriva ora"/"Parti ora" flow working unmodified — it still
-- operates on the bookable leg's own waypoint (the alias), because that is
-- what leg identity and pricing are pinned to — while the real stop (the one
-- shown on the map/narrative, under its own name) stays in sync automatically
-- in both directions.

alter table public.voyage_waypoints
  add column if not exists alias_of_waypoint_id uuid references public.voyage_waypoints(id);

comment on column public.voyage_waypoints.alias_of_waypoint_id is
  'When set, this waypoint (normally actual_status = skipped) stands in for a different real stop reached instead — typically a narrative actual_status = added stop from a route correction. Its actual_arrival_at/actual_departure_at mirror that waypoint''s, kept in sync by sync_voyage_waypoint_alias(). Display code should show the target''s name, e.g. "Reggio Calabria (ex Messina)".';

create or replace function public.sync_voyage_waypoint_alias()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- This row aliases another: push its new actuals onto the target.
  if new.alias_of_waypoint_id is not null then
    update public.voyage_waypoints
    set actual_arrival_at = new.actual_arrival_at,
        actual_departure_at = new.actual_departure_at
    where id = new.alias_of_waypoint_id
      and (actual_arrival_at is distinct from new.actual_arrival_at
        or actual_departure_at is distinct from new.actual_departure_at);
  end if;

  -- This row is someone else's target: push its new actuals onto every alias.
  -- Guarded by IS DISTINCT FROM on both sides, so the two-hop propagation
  -- (alias -> target -> alias) always terminates on the second, no-op pass.
  update public.voyage_waypoints
  set actual_arrival_at = new.actual_arrival_at,
      actual_departure_at = new.actual_departure_at
  where alias_of_waypoint_id = new.id
    and (actual_arrival_at is distinct from new.actual_arrival_at
      or actual_departure_at is distinct from new.actual_departure_at);

  return null;
end;
$$;

drop trigger if exists voyage_waypoint_alias_sync on public.voyage_waypoints;
create trigger voyage_waypoint_alias_sync
  after update of actual_arrival_at, actual_departure_at on public.voyage_waypoints
  for each row
  when (new.actual_arrival_at is distinct from old.actual_arrival_at
     or new.actual_departure_at is distinct from old.actual_departure_at)
  execute function public.sync_voyage_waypoint_alias();

comment on function public.sync_voyage_waypoint_alias() is
  'Keeps actual_arrival_at/actual_departure_at identical between an aliased waypoint (alias_of_waypoint_id) and its target, in either direction.';
