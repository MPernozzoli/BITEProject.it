ALTER TABLE public.voyage_waypoints
  ADD COLUMN IF NOT EXISTS visibility_mode text NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS name_it text,
  ADD COLUMN IF NOT EXISTS name_en text,
  ADD COLUMN IF NOT EXISTS description_it text,
  ADD COLUMN IF NOT EXISTS description_en text,
  ADD COLUMN IF NOT EXISTS event_date date,
  ADD COLUMN IF NOT EXISTS event_time time without time zone,
  ADD COLUMN IF NOT EXISTS media jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.voyage_waypoints
  DROP CONSTRAINT IF EXISTS voyage_waypoints_visibility_mode_check;

ALTER TABLE public.voyage_waypoints
  ADD CONSTRAINT voyage_waypoints_visibility_mode_check
  CHECK (visibility_mode IN ('auto', 'manual'));

UPDATE public.voyage_waypoints
SET
  visibility_mode = 'manual',
  name_it = COALESCE(NULLIF(name_it, ''), NULLIF(name, ''), name_it),
  name_en = COALESCE(NULLIF(name_en, ''), NULLIF(name, ''), name_en),
  media = COALESCE(media, '[]'::jsonb);
