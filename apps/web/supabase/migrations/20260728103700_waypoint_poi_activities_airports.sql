-- Stops only ever carried navigation/media info (name, description, media, timing). Admins want
-- to attach trip-planning detail per stop too — points of interest, planned activities, and nearby
-- airports — so travelers booking a leg can actually plan how to get there and what to do once
-- they land. Same shape as the existing `media` column: a plain jsonb array, normalized/typed on
-- the client (see VoyageWaypoint in voyage-utils.ts), not a relational table — these lists are
-- small, always read/written as a whole with their waypoint, and never queried independently.
alter table public.voyage_waypoints
  add column if not exists poi jsonb not null default '[]'::jsonb,
  add column if not exists activities jsonb not null default '[]'::jsonb,
  add column if not exists nearby_airports jsonb not null default '[]'::jsonb;
