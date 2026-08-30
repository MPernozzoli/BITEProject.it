-- Le metriche articolo tornano raggiungibili dal server MCP.
--
-- `article_metrics` e `article_metrics_detail` chiamano queste due RPC con il
-- client service-role: lì `auth.uid()` è NULL, quindi
-- `has_role(auth.uid(),'admin')` è falso e ogni chiamata moriva su
-- «not authorized». I due tool non hanno mai funzionato.
--
-- Il rimedio è il guardiano già introdotto da `20260830094858`:
-- `can_read_traffic_analytics()` accetta l'admin loggato **oppure** il ruolo
-- `service_role`. Non è un allargamento di privilegi — la service key legge già
-- queste stesse tabelle ignorando le RLS — è il riconoscimento che per l'MCP
-- l'autorizzazione è già stata fatta a monte dal token.
--
-- Corpo identico a quello in produzione (`20260824000003` e
-- `20260720120000`): cambia solo la riga del controllo e si aggiunge la grant a
-- `service_role`.

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
  IF NOT public.can_read_traffic_analytics() THEN
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

REVOKE ALL ON FUNCTION public.admin_article_view_insights() FROM public;
GRANT EXECUTE ON FUNCTION public.admin_article_view_insights() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_article_view_insight_one(_article_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.can_read_traffic_analytics() THEN
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
GRANT EXECUTE ON FUNCTION public.admin_article_view_insight_one(uuid) TO authenticated, service_role;
