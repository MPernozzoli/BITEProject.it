
CREATE TABLE public.article_reads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid NOT NULL REFERENCES public.logbook_articles(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  read_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (article_id, profile_id)
);

ALTER TABLE public.article_reads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own reads" ON public.article_reads
  FOR SELECT TO authenticated
  USING (auth.uid() = profile_id);

CREATE POLICY "Users can insert own reads" ON public.article_reads
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = profile_id);

CREATE POLICY "Service role full access" ON public.article_reads
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
