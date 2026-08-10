-- Anonymous article likes (mirrors the registered/anonymous split already
-- used for article_read_events) + like/comment counters surfaced in the
-- admin article insight panels.

-- 1. Allow article_likes to record an anonymous visitor alongside (or
--    instead of) a profile. -------------------------------------------------
ALTER TABLE public.article_likes
  ALTER COLUMN profile_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS visitor_key text;

ALTER TABLE public.article_likes
  DROP CONSTRAINT IF EXISTS article_likes_identity_chk;
ALTER TABLE public.article_likes
  ADD CONSTRAINT article_likes_identity_chk
  CHECK (profile_id IS NOT NULL OR visitor_key IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS article_likes_article_visitor_unique
  ON public.article_likes (article_id, visitor_key)
  WHERE visitor_key IS NOT NULL;

-- 2. Toggle RPC: identity is resolved server-side (auth.uid() for logged in
--    readers, the client-supplied visitor_key otherwise), same trust model as
--    increment_article_view_count. Direct table INSERT/DELETE stays
--    authenticated-only; anonymous likes always go through this function.
CREATE OR REPLACE FUNCTION public.toggle_article_like(
  _article_id uuid,
  _visitor_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile uuid := auth.uid();
  v_visitor text := nullif(left(btrim(coalesce(_visitor_key, '')), 64), '');
  v_existing uuid;
  v_liked boolean;
  v_count bigint;
BEGIN
  IF v_profile IS NULL AND v_visitor IS NULL THEN
    RAISE EXCEPTION 'visitor key required for anonymous like';
  END IF;

  IF v_profile IS NOT NULL THEN
    SELECT id INTO v_existing FROM public.article_likes
      WHERE article_id = _article_id AND profile_id = v_profile;
  ELSE
    SELECT id INTO v_existing FROM public.article_likes
      WHERE article_id = _article_id AND profile_id IS NULL AND visitor_key = v_visitor;
  END IF;

  IF v_existing IS NOT NULL THEN
    DELETE FROM public.article_likes WHERE id = v_existing;
    v_liked := false;
  ELSE
    BEGIN
      INSERT INTO public.article_likes (article_id, profile_id, visitor_key)
        VALUES (_article_id, v_profile, CASE WHEN v_profile IS NULL THEN v_visitor ELSE NULL END);
    EXCEPTION WHEN unique_violation THEN
      NULL; -- concurrent toggle already recorded the like
    END;
    v_liked := true;
  END IF;

  SELECT count(*) INTO v_count FROM public.article_likes WHERE article_id = _article_id;

  RETURN jsonb_build_object('liked', v_liked, 'count', COALESCE(v_count, 0));
END;
$$;

REVOKE ALL ON FUNCTION public.toggle_article_like(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.toggle_article_like(uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION public.toggle_article_like(uuid, text) TO authenticated;

-- 3. Admin insight list: add like (registered/anonymous split) and comment
--    counters next to the existing view metrics. -----------------------------
DROP FUNCTION IF EXISTS public.admin_article_view_insights();

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
  last_view_at timestamptz,
  like_count bigint,
  registered_likes bigint,
  anonymous_likes bigint,
  comment_count bigint
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
  ),
  lk AS (
    SELECT
      l.article_id,
      count(*) AS like_count,
      count(*) FILTER (WHERE l.profile_id IS NOT NULL) AS registered_likes,
      count(*) FILTER (WHERE l.profile_id IS NULL) AS anonymous_likes
    FROM public.article_likes l
    GROUP BY l.article_id
  ),
  cm AS (
    SELECT c.article_id, count(*) AS comment_count
    FROM public.article_comments c
    GROUP BY c.article_id
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
    ev.last_view_at,
    COALESCE(lk.like_count, 0)::bigint,
    COALESCE(lk.registered_likes, 0)::bigint,
    COALESCE(lk.anonymous_likes, 0)::bigint,
    COALESCE(cm.comment_count, 0)::bigint
  FROM public.logbook_articles a
  LEFT JOIN ev ON ev.article_id = a.id
  LEFT JOIN lk ON lk.article_id = a.id
  LEFT JOIN cm ON cm.article_id = a.id
  ORDER BY COALESCE(a.view_count, 0) DESC, a.published_at DESC NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_article_view_insights() FROM public;
GRANT EXECUTE ON FUNCTION public.admin_article_view_insights() TO authenticated;

-- 4. Admin single-article detail: same additions inside the summary object. --
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
        'last_view_at', max(e.counted_at),
        'like_count', (SELECT count(*) FROM public.article_likes l WHERE l.article_id = a.id),
        'registered_likes', (SELECT count(*) FROM public.article_likes l WHERE l.article_id = a.id AND l.profile_id IS NOT NULL),
        'anonymous_likes', (SELECT count(*) FROM public.article_likes l WHERE l.article_id = a.id AND l.profile_id IS NULL),
        'comment_count', (SELECT count(*) FROM public.article_comments c WHERE c.article_id = a.id)
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
