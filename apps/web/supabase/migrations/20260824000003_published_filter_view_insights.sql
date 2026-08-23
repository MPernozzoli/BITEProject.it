-- Filter admin_article_view_insights() to published articles only.
-- Unpublished articles have no engagement data and should not appear in analytics.

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
  WHERE a.status = 'published'
  ORDER BY COALESCE(a.view_count, 0) DESC, a.published_at DESC NULLS LAST;
END;
$$;
