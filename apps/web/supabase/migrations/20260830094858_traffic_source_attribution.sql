-- Attribuzione della sorgente di traffico.
--
-- Fino a qui gli eventi di lettura sapevano *chi* leggeva (profilo o visitor
-- key), *cosa* e *per quanto*, ma non da dove arrivava. Con i link tracciati
-- (utm_*) generati dal tasto Condividi, dai tool MCP e dal generatore in admin,
-- ogni atterraggio porta con sé la propria provenienza: qui la si persiste
-- accanto all'evento e la si aggrega per il backoffice.
--
-- I valori sono già normalizzati dal client (`lib/utm.ts`): minuscoli, senza
-- accenti, parole separate da trattini. Qui si tronca e si scarta il vuoto, non
-- si ri-normalizza: un solo posto dove si decide la forma.

-- 1. Colonne di attribuzione sugli eventi ------------------------------------

ALTER TABLE public.article_read_events
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS medium text,
  ADD COLUMN IF NOT EXISTS campaign text,
  ADD COLUMN IF NOT EXISTS content text,
  ADD COLUMN IF NOT EXISTS referrer_host text;

COMMENT ON COLUMN public.article_read_events.source IS
  'Sorgente normalizzata della visita (utm_source, click id di piattaforma o referrer classificato). "direct" quando non c''è alcun segnale.';
COMMENT ON COLUMN public.article_read_events.referrer_host IS
  'Host del referrer, quando presente: conserva il dettaglio che la classificazione in source appiattisce.';

CREATE INDEX IF NOT EXISTS idx_article_read_events_source
  ON public.article_read_events (source, counted_at DESC);
CREATE INDEX IF NOT EXISTS idx_article_read_events_campaign
  ON public.article_read_events (campaign, counted_at DESC)
  WHERE campaign IS NOT NULL;

ALTER TABLE public.article_share_events
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS medium text,
  ADD COLUMN IF NOT EXISTS campaign text;

COMMENT ON COLUMN public.article_share_events.source IS
  'Da dove veniva chi ha condiviso: una condivisione fatta da chi era arrivato da Facebook vale come propagazione di quel canale.';

-- 2. Registrazione della visualizzazione, con provenienza --------------------
--
-- Si sostituisce la firma a 3 argomenti invece di affiancarne una nuova: due
-- overload con default sovrapposti renderebbero ambigua ogni chiamata
-- PostgREST. Tutti i parametri restano opzionali, quindi le chiamate legacy a
-- 1, 2 o 3 argomenti continuano a risolvere qui.

DROP FUNCTION IF EXISTS public.increment_article_view_count(uuid, text, text);

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
  v_source text := nullif(left(btrim(lower(coalesce(_source, ''))), 60), '');
  v_medium text := nullif(left(btrim(lower(coalesce(_medium, ''))), 60), '');
  v_campaign text := nullif(left(btrim(lower(coalesce(_campaign, ''))), 60), '');
  v_content text := nullif(left(btrim(lower(coalesce(_content, ''))), 60), '');
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

REVOKE ALL ON FUNCTION public.increment_article_view_count(uuid, text, text, text, text, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.increment_article_view_count(uuid, text, text, text, text, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.increment_article_view_count(uuid, text, text, text, text, text, text, text) TO authenticated;

-- 3. Condivisione, con la provenienza di chi condivide -----------------------

DROP FUNCTION IF EXISTS public.record_article_share(uuid, text, text);

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
    nullif(left(btrim(lower(coalesce(_source, ''))), 60), ''),
    nullif(left(btrim(lower(coalesce(_medium, ''))), 60), ''),
    nullif(left(btrim(lower(coalesce(_campaign, ''))), 60), '')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_article_share(uuid, text, text, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.record_article_share(uuid, text, text, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.record_article_share(uuid, text, text, text, text, text) TO authenticated;

-- 4. Chi può leggere gli aggregati ------------------------------------------
--
-- Due chiamanti legittimi: l'admin loggato nel backoffice (browser, JWT con
-- auth.uid()) e il server MCP, che parla con la service key e quindi non ha
-- alcun auth.uid(). Per la service key non è un allargamento di privilegi —
-- quella chiave legge già le tabelle sottostanti ignorando le RLS — è solo il
-- riconoscimento che l'autorizzazione, lì, è già stata fatta a monte dal
-- token MCP.

CREATE OR REPLACE FUNCTION public.can_read_traffic_analytics()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(auth.uid(), 'admin')
     OR coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role';
$$;

REVOKE ALL ON FUNCTION public.can_read_traffic_analytics() FROM public;
GRANT EXECUTE ON FUNCTION public.can_read_traffic_analytics() TO authenticated, service_role;

-- 5. Aggregato admin: una riga per canale ------------------------------------
--
-- `_article_id` nullo = tutto il sito; valorizzato = il singolo articolo, che è
-- ciò che serve al pannello di dettaglio. Una funzione sola perché la domanda
-- è la stessa, cambia solo l'ampiezza.

CREATE OR REPLACE FUNCTION public.admin_traffic_sources(
  _days integer DEFAULT 30,
  _article_id uuid DEFAULT NULL
)
RETURNS TABLE (
  source text,
  medium text,
  campaign text,
  views bigint,
  unique_visitors bigint,
  registered_views bigint,
  articles bigint,
  avg_dwell_ms numeric,
  last_view_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(_days, 30), 730)));
BEGIN
  IF NOT public.can_read_traffic_analytics() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(e.source, 'direct')::text,
    COALESCE(e.medium, 'none')::text,
    e.campaign::text,
    count(*)::bigint,
    count(DISTINCT COALESCE(e.profile_id::text, e.visitor_key))::bigint,
    count(*) FILTER (WHERE e.profile_id IS NOT NULL)::bigint,
    count(DISTINCT e.article_id)::bigint,
    round(avg(e.dwell_ms) FILTER (WHERE e.dwell_ms IS NOT NULL AND e.dwell_ms > 0))::numeric,
    max(e.counted_at)
  FROM public.article_read_events e
  WHERE e.counted_at >= v_since
    AND (_article_id IS NULL OR e.article_id = _article_id)
  GROUP BY 1, 2, 3
  ORDER BY count(*) DESC, 1, 2;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_traffic_sources(integer, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_traffic_sources(integer, uuid) TO authenticated, service_role;

-- 6. Aggregato admin: quali articoli alimenta un canale ----------------------

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
  v_source text := nullif(btrim(lower(coalesce(_source, ''))), '');
  v_medium text := nullif(btrim(lower(coalesce(_medium, ''))), '');
  v_campaign text := nullif(btrim(lower(coalesce(_campaign, ''))), '');
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

REVOKE ALL ON FUNCTION public.admin_traffic_source_articles(text, integer, text, text, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_traffic_source_articles(text, integer, text, text, integer) TO authenticated, service_role;
