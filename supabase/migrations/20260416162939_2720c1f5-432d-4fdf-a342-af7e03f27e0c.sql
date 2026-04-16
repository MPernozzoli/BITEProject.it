ALTER TABLE public.logbook_articles
  ADD COLUMN IF NOT EXISTS voyage_waypoint_start_id uuid REFERENCES public.voyage_waypoints(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS voyage_waypoint_end_id uuid REFERENCES public.voyage_waypoints(id) ON DELETE SET NULL;