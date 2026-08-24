-- Fix compute_article_score: separate share_count and click_count
-- The bug: v_share_count variable was reused for click events, causing share_count in JSON to return clicks.

CREATE OR REPLACE FUNCTION public.compute_article_score(_article_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_view_count int;
  v_unique_readers_30d int;
  v_avg_dwell_ms numeric;
  v_scroll_50pct_pct numeric;
  v_like_count int;
  v_comment_count int;
  v_share_count int;
  v_click_count int;
  v_read_count int;
  v_unique_readers int;
  v_score jsonb;
  v_reach smallint;
  v_read_score smallint;
  v_react smallint;
  v_retain smallint;
  v_revenue smallint;
BEGIN
  -- Reach: unique readers in last 30 days
  SELECT count(distinct coalesce(profile_id::text, visitor_key))
  INTO v_unique_readers_30d
  FROM public.article_read_events
  WHERE article_id = _article_id
    AND counted_at >= now() - interval '30 days';

  -- Reach score: 0 (<50), 1 (50-500), 2 (>500)
  v_reach := CASE
    WHEN v_unique_readers_30d > 500 THEN 2
    WHEN v_unique_readers_30d >= 50 THEN 1
    ELSE 0
  END;

  -- Read: avg dwell time + scroll depth
  SELECT avg(dwell_ms) INTO v_avg_dwell_ms
  FROM public.article_read_events
  WHERE article_id = _article_id
    AND dwell_ms > 0
    AND counted_at >= now() - interval '30 days';

  SELECT coalesce(avg(max_scroll_pct), 0) INTO v_scroll_50pct_pct
  FROM public.article_scroll_events
  WHERE article_id = _article_id
    AND created_at >= now() - interval '30 days';

  -- Read score: dwell >= 90s AND scroll >= 50% = 2, either >= 1, else 0
  v_read_score := CASE
    WHEN coalesce(v_avg_dwell_ms, 0) >= 90000 AND v_scroll_50pct_pct >= 50 THEN 2
    WHEN coalesce(v_avg_dwell_ms, 0) >= 30000 OR v_scroll_50pct_pct >= 30 THEN 1
    ELSE 0
  END;

  -- React: likes + comments + shares per 100 readers
  SELECT count(*) INTO v_like_count
  FROM public.article_likes
  WHERE article_id = _article_id;

  SELECT count(*) INTO v_comment_count
  FROM public.article_comments
  WHERE article_id = _article_id;

  SELECT count(*) INTO v_share_count
  FROM public.article_share_events
  WHERE article_id = _article_id;

  -- React score: >= 5 reactions/100 readers = 2, >= 1/100 = 1, else 0
  v_react := CASE
    WHEN v_unique_readers_30d > 0 AND ((v_like_count + v_comment_count + v_share_count)::numeric / v_unique_readers_30d * 100) >= 5 THEN 2
    WHEN v_unique_readers_30d > 0 AND ((v_like_count + v_comment_count + v_share_count)::numeric / v_unique_readers_30d * 100) >= 1 THEN 1
    ELSE 0
  END;

  -- Retain: unique readers (all time) as proxy for returning audience
  SELECT count(distinct coalesce(profile_id::text, visitor_key))
  INTO v_unique_readers
  FROM public.article_read_events
  WHERE article_id = _article_id;

  -- Retain score: >200 unique = 2, >50 = 1, else 0
  v_retain := CASE
    WHEN v_unique_readers > 200 THEN 2
    WHEN v_unique_readers > 50 THEN 1
    ELSE 0
  END;

  -- Revenue/Lead: clicks on links/CTAs (separate variable!)
  SELECT count(*) INTO v_click_count
  FROM public.article_click_events
  WHERE article_id = _article_id
    AND created_at >= now() - interval '30 days';

  v_revenue := CASE
    WHEN v_click_count >= 10 THEN 2
    WHEN v_click_count >= 3 THEN 1
    ELSE 0
  END;

  v_score := jsonb_build_object(
    'reach', v_reach,
    'read', v_read_score,
    'react', v_react,
    'retain', v_retain,
    'revenue', v_revenue,
    'total', (v_reach + v_read_score + v_react + v_retain + v_revenue)::int,
    'reach_count', v_unique_readers_30d,
    'avg_dwell_ms', coalesce(v_avg_dwell_ms, 0)::int,
    'scroll_pct', v_scroll_50pct_pct::int,
    'like_count', v_like_count,
    'comment_count', v_comment_count,
    'share_count', v_share_count,
    'click_count', v_click_count,
    'unique_readers', v_unique_readers
  );

  RETURN v_score;
END;
$$;

GRANT EXECUTE ON FUNCTION public.compute_article_score(uuid) TO anon, authenticated;