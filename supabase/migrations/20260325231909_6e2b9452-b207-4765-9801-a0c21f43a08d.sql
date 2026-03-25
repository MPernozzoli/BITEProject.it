
CREATE TABLE public.route_legs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT '',
  description text DEFAULT '',
  lat_start double precision DEFAULT 0,
  lng_start double precision DEFAULT 0,
  lat_end double precision DEFAULT 0,
  lng_end double precision DEFAULT 0,
  nautical_miles numeric DEFAULT 0,
  status text NOT NULL DEFAULT 'future' CHECK (status IN ('past', 'current', 'future')),
  sort_order integer NOT NULL DEFAULT 0,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.route_legs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view route legs" ON public.route_legs
  FOR SELECT TO public USING (true);

CREATE POLICY "Admins can manage route legs" ON public.route_legs
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_route_legs_updated_at
  BEFORE UPDATE ON public.route_legs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
