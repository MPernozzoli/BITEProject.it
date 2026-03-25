-- Create article status enum
CREATE TYPE public.article_status AS ENUM ('draft', 'scheduled', 'published');

-- Create logbook articles table
CREATE TABLE public.logbook_articles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title_en TEXT NOT NULL DEFAULT '',
  title_it TEXT NOT NULL DEFAULT '',
  slug TEXT NOT NULL UNIQUE,
  excerpt_en TEXT DEFAULT '',
  excerpt_it TEXT DEFAULT '',
  content_en JSONB DEFAULT '{}',
  content_it JSONB DEFAULT '{}',
  cover_image TEXT DEFAULT '',
  category TEXT NOT NULL DEFAULT 'Notes from the Boat',
  status article_status NOT NULL DEFAULT 'draft',
  published_at TIMESTAMP WITH TIME ZONE,
  scheduled_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.logbook_articles ENABLE ROW LEVEL SECURITY;

-- Public can read published articles
CREATE POLICY "Published articles are public"
  ON public.logbook_articles
  FOR SELECT
  USING (status = 'published' AND (published_at IS NULL OR published_at <= now()));

-- Authenticated users can do everything (admin)
CREATE POLICY "Authenticated users can manage articles"
  ON public.logbook_articles
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Timestamp trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_logbook_articles_updated_at
  BEFORE UPDATE ON public.logbook_articles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Storage bucket for article media
INSERT INTO storage.buckets (id, name, public)
VALUES ('logbook-media', 'logbook-media', true);

-- Public can view media
CREATE POLICY "Logbook media is public"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'logbook-media');

-- Authenticated can upload/update/delete media
CREATE POLICY "Auth users can upload media"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'logbook-media');

CREATE POLICY "Auth users can update media"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'logbook-media');

CREATE POLICY "Auth users can delete media"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'logbook-media');