ALTER TABLE public.voyage_waypoints 
  ADD COLUMN IF NOT EXISTS waypoint_type text NOT NULL DEFAULT 'narrative',
  ADD COLUMN IF NOT EXISTS date_start timestamptz,
  ADD COLUMN IF NOT EXISTS date_end timestamptz;