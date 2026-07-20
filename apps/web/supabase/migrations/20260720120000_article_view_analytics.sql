-- Article view analytics: enrich per-view events with registered/anonymous
-- attribution, viewing language and reading (dwell) time, and expose admin
-- aggregation RPCs for the editorial calendar insight panels.

-- 1. Enrich the existing per-view event table -------------------------------
ALTER TABLE public.article_read_events
  ADD COLUMN IF NOT EXISTS lang text,
  ADD COLUMN IF NOT EXISTS dwell_ms integer;

CREATE INDEX IF NOT EXISTS idx_article_read_events_article
  ON public.article_read_events (article_id);
CREATE INDEX IF NOT EXISTS idx_article_read_events_article_counted
  ON public.article_read_events (article_id, counted_at DESC);
CREATE INDEX IF NOT EXISTS idx_article_read_events_visitor_recent
  ON public.article_read_events (article_id, visitor_key, counted_at DESC);

-- 2. Increment RPC: attribute to the authenticated profile (never trust the
--    client for identity) and capture the viewing language. Backwards
--    compatible: legacy 1- and 2-arg call sites keep working via defaults.
DROP FUNCTION IF EXISTS public.increment_article_view_count(uuid, text);
DROP FUNCTION IF EXISTS public.increment_article_view_count(uuid);

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

REVOKE ALL ON FUNCTION public.increment_article_view_count(uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.increment_article_view_count(uuid, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.increment_article_view_count(uuid, text, text) TO authenticated;

-- 3. Reading (dwell) time RPC: merged onto the latest matching view event for
--    the same visitor/profile within a short window; keeps the longest value.
CREATE OR REPLACE FUNCTION public.record_article_read_dwell(
  _article_id uuid,
  _visitor_key text,
  _dwell_ms integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_visitor text := nullif(left(btrim(coalesce(_visitor_key, '')), 64), '');
  v_dwell integer := greatest(0, least(coalesce(_dwell_ms, 0), 6 * 60 * 60 * 1000));
  v_id uuid;
BEGIN
  IF v_dwell <= 0 THEN
    RETURN;
  END IF;

  SELECT id INTO v_id
  FROM public.article_read_events
  WHERE article_id = _article_id
    AND (
      (v_visitor IS NOT NULL AND visitor_key = v_visitor)
      OR (v_visitor IS NULL AND auth.uid() IS NOT NULL AND profile_id = auth.uid())
    )
    AND counted_at >= now() - interval '6 hours'
  ORDER BY counted_at DESC
  LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO public.article_read_events (article_id, profile_id, visitor_key, dwell_ms)
    VALUES (_article_id, auth.uid(), v_visitor, v_dwell);
  ELSE
    UPDATE public.article_read_events
      SET dwell_ms = greatest(coalesce(dwell_ms, 0), v_dwell),
          profile_id = coalesce(profile_id, auth.uid())
      WHERE id = v_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.record_article_read_dwell(uuid, text, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.record_article_read_dwell(uuid, text, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.record_article_read_dwell(uuid, text, integer) TO authenticated;

-- 4. Admin aggregate: one row per article with the headline metrics. --------
CREATE OR REPLACE FUNCTION public.admin_article_view_insights()
RETURNS TABLE (
  article_id uuid,
  title_it text,
  title_en text,
  story_id uuid,
  status text,
  published_at timestamptz,
  view_count bigint,
  tracked_views bigint,
  registered_views bigint,
  anonymous_views bigint,
  distinct_visitors bigint,
  distinct_registered bigint,
  avg_dwell_ms numeric,
  measured_dwell_count bigint,
  views_it bigint,
  views_en bigint,
  top_lang text,
  last_view_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN QUERY
  WITH ev AS (
    SELECT
      e.article_id,
      count(*) AS tracked_views,
      count(*) FILTER (WHERE e.profile_id IS NOT NULL) AS registered_views,
      count(*) FILTER (WHERE e.profile_id IS NULL) AS anonymous_views,
      count(DISTINCT e.visitor_key) FILTER (WHERE e.visitor_key IS NOT NULL) AS distinct_visitors,
      count(DISTINCT e.profile_id) FILTER (WHERE e.profile_id IS NOT NULL) AS distinct_registered,
      avg(e.dwell_ms) FILTER (WHERE e.dwell_ms IS NOT NULL AND e.dwell_ms > 0) AS avg_dwell_ms,
      count(*) FILTER (WHERE e.dwell_ms IS NOT NULL AND e.dwell_ms > 0) AS measured_dwell_count,
      count(*) FILTER (WHERE e.lang = 'it') AS views_it,
      count(*) FILTER (WHERE e.lang = 'en') AS views_en,
      max(e.counted_at) AS last_view_at
    FROM public.article_read_events e
    GROUP BY e.article_id
  )
  SELECT
    a.id,
    a.title_it,
    a.title_en,
    a.story_id,
    a.status::text,
    a.published_at,
    COALESCE(a.view_count, 0)::bigint,
    COALESCE(ev.tracked_views, 0)::bigint,
    COALESCE(ev.registered_views, 0)::bigint,
    COALESCE(ev.anonymous_views, 0)::bigint,
    COALESCE(ev.distinct_visitors, 0)::bigint,
    COALESCE(ev.distinct_registered, 0)::bigint,
    round(ev.avg_dwell_ms)::numeric,
    COALESCE(ev.measured_dwell_count, 0)::bigint,
    COALESCE(ev.views_it, 0)::bigint,
    COALESCE(ev.views_en, 0)::bigint,
    CASE
      WHEN COALESCE(ev.views_it, 0) = 0 AND COALESCE(ev.views_en, 0) = 0 THEN NULL
      WHEN COALESCE(ev.views_it, 0) >= COALESCE(ev.views_en, 0) THEN 'it'
      ELSE 'en'
    END,
    ev.last_view_at
  FROM public.logbook_articles a
  LEFT JOIN ev ON ev.article_id = a.id
  ORDER BY COALESCE(a.view_count, 0) DESC, a.published_at DESC NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_article_view_insights() FROM public;
GRANT EXECUTE ON FUNCTION public.admin_article_view_insights() TO authenticated;

-- 5. Admin single-article detail: summary + language split + 30-day series. --
CREATE OR REPLACE FUNCTION public.admin_article_view_insight_one(_article_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT jsonb_build_object(
    'article_id', a.id,
    'title_it', a.title_it,
    'title_en', a.title_en,
    'story_id', a.story_id,
    'status', a.status::text,
    'published_at', a.published_at,
    'view_count', COALESCE(a.view_count, 0),
    'summary', (
      SELECT jsonb_build_object(
        'tracked_views', count(*),
        'registered_views', count(*) FILTER (WHERE e.profile_id IS NOT NULL),
        'anonymous_views', count(*) FILTER (WHERE e.profile_id IS NULL),
        'distinct_visitors', count(DISTINCT e.visitor_key) FILTER (WHERE e.visitor_key IS NOT NULL),
        'distinct_registered', count(DISTINCT e.profile_id) FILTER (WHERE e.profile_id IS NOT NULL),
        'avg_dwell_ms', round(avg(e.dwell_ms) FILTER (WHERE e.dwell_ms IS NOT NULL AND e.dwell_ms > 0)),
        'measured_dwell_count', count(*) FILTER (WHERE e.dwell_ms IS NOT NULL AND e.dwell_ms > 0),
        'views_it', count(*) FILTER (WHERE e.lang = 'it'),
        'views_en', count(*) FILTER (WHERE e.lang = 'en'),
        'views_unknown_lang', count(*) FILTER (WHERE e.lang IS NULL),
        'first_view_at', min(e.counted_at),
        'last_view_at', max(e.counted_at)
      )
      FROM public.article_read_events e
      WHERE e.article_id = a.id
    ),
    'daily', (
      SELECT COALESCE(jsonb_agg(s.d ORDER BY s.day), '[]'::jsonb)
      FROM (
        SELECT
          to_char(date_trunc('day', e.counted_at), 'YYYY-MM-DD') AS day,
          jsonb_build_object(
            'day', to_char(date_trunc('day', e.counted_at), 'YYYY-MM-DD'),
            'views', count(*),
            'registered', count(*) FILTER (WHERE e.profile_id IS NOT NULL)
          ) AS d
        FROM public.article_read_events e
        WHERE e.article_id = a.id
          AND e.counted_at >= now() - interval '30 days'
        GROUP BY 1
      ) s
    )
  ) INTO v_result
  FROM public.logbook_articles a
  WHERE a.id = _article_id;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_article_view_insight_one(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_article_view_insight_one(uuid) TO authenticated;
