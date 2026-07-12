ALTER TABLE public.logbook_articles
  ADD COLUMN IF NOT EXISTS view_count bigint NOT NULL DEFAULT 0;
CREATE OR REPLACE FUNCTION public.increment_article_view_count(_article_id uuid)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count bigint;
BEGIN
  UPDATE public.logbook_articles
  SET view_count = COALESCE(view_count, 0) + 1
  WHERE id = _article_id
    AND status = 'published'
    AND (published_at IS NULL OR published_at <= now())
  RETURNING view_count INTO v_count;

  IF v_count IS NULL THEN
    SELECT COALESCE(view_count, 0) INTO v_count
    FROM public.logbook_articles
    WHERE id = _article_id;
  END IF;

  RETURN COALESCE(v_count, 0);
END;
$$;
REVOKE ALL ON FUNCTION public.increment_article_view_count(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.increment_article_view_count(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.increment_article_view_count(uuid) TO authenticated;
