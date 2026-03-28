CREATE TABLE IF NOT EXISTS public.article_read_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid NOT NULL REFERENCES public.logbook_articles(id) ON DELETE CASCADE,
  profile_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  visitor_key text,
  counted_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT article_read_events_actor_check CHECK (
    profile_id IS NOT NULL OR (visitor_key IS NOT NULL AND btrim(visitor_key) <> '')
  )
);

CREATE INDEX IF NOT EXISTS article_read_events_article_id_counted_at_idx
  ON public.article_read_events (article_id, counted_at DESC);

CREATE INDEX IF NOT EXISTS article_read_events_profile_id_article_id_counted_at_idx
  ON public.article_read_events (profile_id, article_id, counted_at DESC)
  WHERE profile_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS article_read_events_visitor_key_article_id_counted_at_idx
  ON public.article_read_events (visitor_key, article_id, counted_at DESC)
  WHERE visitor_key IS NOT NULL;

ALTER TABLE public.article_read_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to article read events"
ON public.article_read_events
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DROP FUNCTION IF EXISTS public.increment_article_view_count(uuid);

CREATE OR REPLACE FUNCTION public.increment_article_view_count(
  _article_id uuid,
  _visitor_key text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count bigint := 0;
  v_now timestamp with time zone := now();
  v_profile_id uuid := auth.uid();
  v_normalized_visitor_key text := NULLIF(btrim(_visitor_key), '');
  v_actor_key text;
BEGIN
  IF v_profile_id IS NOT NULL THEN
    v_actor_key := 'user:' || v_profile_id::text;
  ELSIF v_normalized_visitor_key IS NOT NULL THEN
    v_actor_key := 'anon:' || v_normalized_visitor_key;
  END IF;

  IF v_actor_key IS NULL THEN
    SELECT COALESCE(view_count, 0) INTO v_count
    FROM public.logbook_articles
    WHERE id = _article_id;

    RETURN COALESCE(v_count, 0);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_actor_key || ':' || _article_id::text, 0));

  SELECT COALESCE(view_count, 0) INTO v_count
  FROM public.logbook_articles
  WHERE id = _article_id
    AND status = 'published'
    AND (published_at IS NULL OR published_at <= v_now);

  IF NOT FOUND THEN
    SELECT COALESCE(view_count, 0) INTO v_count
    FROM public.logbook_articles
    WHERE id = _article_id;

    RETURN COALESCE(v_count, 0);
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.article_read_events
    WHERE article_id = _article_id
      AND counted_at > v_now - interval '1 hour'
      AND (
        (v_profile_id IS NOT NULL AND profile_id = v_profile_id)
        OR (v_profile_id IS NULL AND visitor_key = v_normalized_visitor_key)
      )
  ) THEN
    RETURN COALESCE(v_count, 0);
  END IF;

  INSERT INTO public.article_read_events (article_id, profile_id, visitor_key, counted_at)
  VALUES (
    _article_id,
    v_profile_id,
    CASE WHEN v_profile_id IS NULL THEN v_normalized_visitor_key ELSE NULL END,
    v_now
  );

  IF v_profile_id IS NOT NULL THEN
    INSERT INTO public.article_reads (article_id, profile_id, read_at)
    VALUES (_article_id, v_profile_id, v_now)
    ON CONFLICT (article_id, profile_id) DO NOTHING;
  END IF;

  UPDATE public.logbook_articles
  SET view_count = COALESCE(view_count, 0) + 1
  WHERE id = _article_id
  RETURNING view_count INTO v_count;

  RETURN COALESCE(v_count, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.increment_article_view_count(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.increment_article_view_count(uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION public.increment_article_view_count(uuid, text) TO authenticated;
