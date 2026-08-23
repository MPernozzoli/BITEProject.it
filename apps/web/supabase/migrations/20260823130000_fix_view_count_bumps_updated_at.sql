-- Fix: increment_article_view_count should not bump updated_at on logbook_articles.
--
-- The UPDATE on logbook_articles triggers the BEFORE UPDATE trigger that calls
-- update_updated_at_column(), which erroneously sets updated_at = now() every time
-- someone merely views the article.  Temporarily disable row-level triggers during
-- the view-count UPDATE so that only the editorial save path bumps updated_at.

CREATE OR REPLACE FUNCTION public.increment_article_view_count(
  _article_id uuid,
  _visitor_key text DEFAULT NULL,
  _lang text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count bigint;
  v_lang text := nullif(left(btrim(coalesce(_lang, '')), 8), '');
  v_visitor text := nullif(left(btrim(coalesce(_visitor_key, '')), 64), '');
BEGIN
  BEGIN
    INSERT INTO public.article_read_events (article_id, profile_id, visitor_key, lang)
    VALUES (_article_id, auth.uid(), v_visitor, v_lang);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Disable row-level triggers (including the updated_at bump) so that
  -- incrementing view_count does not count as an editorial modification.
  SET LOCAL session_replication_role = 'replica';

  UPDATE public.logbook_articles
    SET view_count = COALESCE(view_count, 0) + 1
    WHERE id = _article_id
      AND status = 'published'
      AND (published_at IS NULL OR published_at <= now())
    RETURNING view_count INTO v_count;

  -- Restore normal trigger behaviour (resets at end of transaction anyway).
  SET LOCAL session_replication_role = 'origin';

  IF v_count IS NULL THEN
    SELECT COALESCE(view_count, 0) INTO v_count
    FROM public.logbook_articles
    WHERE id = _article_id;
  END IF;

  RETURN COALESCE(v_count, 0);
END;
$$;
