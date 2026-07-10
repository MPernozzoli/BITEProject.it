-- Specific hazards behind a leg's manual danger_level rating (e.g. "orca_encounter",
-- "piracy"), surfaced as icon+label chips in the complexity tooltip instead of a generic
-- disclaimer. The allowed keys mirror the catalog in src/lib/danger-reasons.ts — keep both
-- in sync when adding a new reason.
alter table public.voyage_bookable_legs
  add column if not exists danger_reasons text[] not null default '{}';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'voyage_bookable_legs_danger_reasons_check'
  ) then
    alter table public.voyage_bookable_legs
      add constraint voyage_bookable_legs_danger_reasons_check
      check (
        danger_reasons <@ array[
          'orca_encounter',
          'strong_currents',
          'strong_winds',
          'piracy',
          'heavy_traffic',
          'poor_visibility',
          'remote_rescue'
        ]::text[]
      );
  end if;
end $$;
