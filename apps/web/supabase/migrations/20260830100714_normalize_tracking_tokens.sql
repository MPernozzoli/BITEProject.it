-- La normalizzazione dei tracker vale anche lato database.
--
-- La forma dei valori la decide `lib/utm.ts` e in produzione ci passa tutto:
-- il tasto Condividi, i tool MCP, il generatore in admin. Ma la RPC è
-- raggiungibile anche da fuori quel percorso, e basta un `utm_campaign=Vela
-- Lenta` non normalizzato perché lo stesso gruppo compaia due volte nei report
-- come "vela lenta" e "vela-lenta". Il costo di renderlo impossibile è una
-- funzione di tre righe: qui si applica la stessa regola del client.

-- `unaccent` è un'estensione che qui non c'è: la traslitterazione minima delle
-- vocali accentate italiane copre i casi reali senza aggiungere dipendenze.
CREATE OR REPLACE FUNCTION public.unaccent_fallback(_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT translate(
    coalesce(_value, ''),
    'àáâãäåèéêëìíîïòóôõöùúûüçñÀÁÂÃÄÅÈÉÊËÌÍÎÏÒÓÔÕÖÙÚÛÜÇÑ',
    'aaaaaaeeeeiiiiooooouuuucnAAAAAAEEEEIIIIOOOOOUUUUCN'
  );
$$;

CREATE OR REPLACE FUNCTION public.normalize_tracking_token(_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT nullif(
    left(
      btrim(
        regexp_replace(lower(public.unaccent_fallback(coalesce(_value, ''))), '[^a-z0-9]+', '-', 'g'),
        '-'
      ),
      60
    ),
    ''
  );
$$;

CREATE OR REPLACE FUNCTION public.increment_article_view_count(
  _article_id uuid,
  _visitor_key text DEFAULT NULL,
  _lang text DEFAULT NULL,
  _source text DEFAULT NULL,
  _medium text DEFAULT NULL,
  _campaign text DEFAULT NULL,
  _content text DEFAULT NULL,
  _referrer_host text DEFAULT NULL
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
  v_source text := public.normalize_tracking_token(_source);
  v_medium text := public.normalize_tracking_token(_medium);
  v_campaign text := public.normalize_tracking_token(_campaign);
  v_content text := public.normalize_tracking_token(_content);
  -- L'host resta un host: i punti sono significativi, non separatori.
  v_referrer text := nullif(left(btrim(lower(coalesce(_referrer_host, ''))), 120), '');
BEGIN
  BEGIN
    INSERT INTO public.article_read_events (
      article_id, profile_id, visitor_key, lang, source, medium, campaign, content, referrer_host
    )
    VALUES (
      _article_id, auth.uid(), v_visitor, v_lang, v_source, v_medium, v_campaign, v_content, v_referrer
    );
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

CREATE OR REPLACE FUNCTION public.record_article_share(
  _article_id uuid,
  _visitor_key text DEFAULT NULL,
  _method text DEFAULT 'link',
  _source text DEFAULT NULL,
  _medium text DEFAULT NULL,
  _campaign text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.article_share_events (
    article_id, profile_id, visitor_key, method, source, medium, campaign
  )
  VALUES (
    _article_id,
    auth.uid(),
    nullif(left(btrim(coalesce(_visitor_key, '')), 64), ''),
    coalesce(nullif(btrim(_method), ''), 'link'),
    public.normalize_tracking_token(_source),
    public.normalize_tracking_token(_medium),
    public.normalize_tracking_token(_campaign)
  );
END;
$$;

-- Anche la lettura normalizza i filtri: chiedere "Vela Lenta" e non trovare
-- nulla perché in tabella c'è "vela-lenta" sarebbe un modo silenzioso di
-- mentire.
CREATE OR REPLACE FUNCTION public.admin_traffic_source_articles(
  _source text,
  _days integer DEFAULT 30,
  _medium text DEFAULT NULL,
  _campaign text DEFAULT NULL,
  _limit integer DEFAULT 20
)
RETURNS TABLE (
  article_id uuid,
  title_it text,
  title_en text,
  slug text,
  views bigint,
  unique_visitors bigint,
  avg_dwell_ms numeric,
  last_view_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(_days, 30), 730)));
  v_source text := public.normalize_tracking_token(_source);
  v_medium text := public.normalize_tracking_token(_medium);
  v_campaign text := public.normalize_tracking_token(_campaign);
BEGIN
  IF NOT public.can_read_traffic_analytics() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN QUERY
  SELECT
    a.id,
    a.title_it,
    a.title_en,
    a.slug,
    count(*)::bigint,
    count(DISTINCT COALESCE(e.profile_id::text, e.visitor_key))::bigint,
    round(avg(e.dwell_ms) FILTER (WHERE e.dwell_ms IS NOT NULL AND e.dwell_ms > 0))::numeric,
    max(e.counted_at)
  FROM public.article_read_events e
  JOIN public.logbook_articles a ON a.id = e.article_id
  WHERE e.counted_at >= v_since
    AND COALESCE(e.source, 'direct') = COALESCE(v_source, 'direct')
    AND (v_medium IS NULL OR COALESCE(e.medium, 'none') = v_medium)
    AND (v_campaign IS NULL OR e.campaign = v_campaign)
  GROUP BY a.id, a.title_it, a.title_en, a.slug
  ORDER BY count(*) DESC
  LIMIT greatest(1, least(coalesce(_limit, 20), 200));
END;
$$;

REVOKE ALL ON FUNCTION public.normalize_tracking_token(text) FROM public;
GRANT EXECUTE ON FUNCTION public.normalize_tracking_token(text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.unaccent_fallback(text) FROM public;
GRANT EXECUTE ON FUNCTION public.unaccent_fallback(text) TO anon, authenticated, service_role;
