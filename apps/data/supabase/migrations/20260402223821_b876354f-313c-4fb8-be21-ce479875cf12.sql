
-- Create enums matching BITE Project
CREATE TYPE public.voyage_status AS ENUM ('planned', 'active', 'completed');
CREATE TYPE public.voyage_type AS ENUM ('water', 'land');

-- Voyages table (mirrors BITE Project)
CREATE TABLE public.voyages (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  name_en TEXT,
  name_it TEXT,
  description TEXT,
  description_en TEXT,
  description_it TEXT,
  start_date TEXT,
  start_time TEXT,
  end_date TEXT,
  end_time TEXT,
  status voyage_status NOT NULL DEFAULT 'planned',
  type voyage_type NOT NULL DEFAULT 'water',
  cached_geometry JSONB,
  is_published BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.voyages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access on voyages"
  ON public.voyages FOR SELECT
  USING (true);

-- Voyage waypoints table
CREATE TABLE public.voyage_waypoints (
  id UUID PRIMARY KEY,
  voyage_id UUID NOT NULL REFERENCES public.voyages(id) ON DELETE CASCADE,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  name TEXT,
  name_en TEXT,
  name_it TEXT,
  description_en TEXT,
  description_it TEXT,
  waypoint_type TEXT NOT NULL DEFAULT 'stop',
  sort_order INTEGER NOT NULL DEFAULT 0,
  visibility_mode TEXT NOT NULL DEFAULT 'visible',
  media JSONB NOT NULL DEFAULT '[]'::jsonb,
  date_start TEXT,
  date_end TEXT,
  event_date TEXT,
  event_time TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.voyage_waypoints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access on voyage_waypoints"
  ON public.voyage_waypoints FOR SELECT
  USING (true);

-- Route legs table
CREATE TABLE public.route_legs (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  description TEXT,
  lat_start DOUBLE PRECISION,
  lng_start DOUBLE PRECISION,
  lat_end DOUBLE PRECISION,
  lng_end DOUBLE PRECISION,
  nautical_miles DOUBLE PRECISION,
  status TEXT NOT NULL DEFAULT 'planned',
  sort_order INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.route_legs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access on route_legs"
  ON public.route_legs FOR SELECT
  USING (true);

-- Indexes
CREATE INDEX idx_voyage_waypoints_voyage_id ON public.voyage_waypoints(voyage_id);
CREATE INDEX idx_voyages_status ON public.voyages(status);
CREATE INDEX idx_voyages_is_published ON public.voyages(is_published);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_voyages_updated_at
  BEFORE UPDATE ON public.voyages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_route_legs_updated_at
  BEFORE UPDATE ON public.route_legs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
