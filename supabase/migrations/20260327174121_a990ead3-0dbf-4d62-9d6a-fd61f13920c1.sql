
-- Create enums
CREATE TYPE public.voyage_type AS ENUM ('water', 'land');
CREATE TYPE public.voyage_status AS ENUM ('planned', 'active', 'completed');

-- Create voyages table
CREATE TABLE public.voyages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  description TEXT DEFAULT '',
  type voyage_type NOT NULL DEFAULT 'water',
  status voyage_status NOT NULL DEFAULT 'planned',
  sort_order INTEGER NOT NULL DEFAULT 0,
  cached_geometry JSONB DEFAULT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create voyage_waypoints table
CREATE TABLE public.voyage_waypoints (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  voyage_id UUID NOT NULL REFERENCES public.voyages(id) ON DELETE CASCADE,
  lat DOUBLE PRECISION NOT NULL DEFAULT 0,
  lng DOUBLE PRECISION NOT NULL DEFAULT 0,
  name TEXT DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Add geo columns to logbook_articles
ALTER TABLE public.logbook_articles
  ADD COLUMN latitude DOUBLE PRECISION DEFAULT NULL,
  ADD COLUMN longitude DOUBLE PRECISION DEFAULT NULL,
  ADD COLUMN voyage_id UUID DEFAULT NULL REFERENCES public.voyages(id) ON DELETE SET NULL,
  ADD COLUMN voyage_segment_start INTEGER DEFAULT NULL,
  ADD COLUMN voyage_segment_end INTEGER DEFAULT NULL,
  ADD COLUMN location_name TEXT DEFAULT NULL;

-- Enable RLS
ALTER TABLE public.voyages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voyage_waypoints ENABLE ROW LEVEL SECURITY;

-- RLS: voyages readable by all, writable by admin
CREATE POLICY "Anyone can view voyages" ON public.voyages FOR SELECT TO public USING (true);
CREATE POLICY "Admins can manage voyages" ON public.voyages FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- RLS: voyage_waypoints readable by all, writable by admin
CREATE POLICY "Anyone can view waypoints" ON public.voyage_waypoints FOR SELECT TO public USING (true);
CREATE POLICY "Admins can manage waypoints" ON public.voyage_waypoints FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Updated_at trigger for voyages
CREATE TRIGGER update_voyages_updated_at BEFORE UPDATE ON public.voyages FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
