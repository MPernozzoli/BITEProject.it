-- Analytics delle pagine viaggio.
--
-- Fino a qui il backoffice sapeva misurare solo gli articoli: chi li legge, da
-- dove arriva, per quanto resta. Le pagine viaggio — che sono l'altra metà del
-- sito, e l'unica che porta a una richiesta di imbarco — non lasciavano alcuna
-- traccia. La dashboard Performance mostrava quindi metà della realtà.
--
-- Qui si replica per i viaggi la stessa grammatica già in uso per gli articoli
-- (`article_read_events` + RPC di scrittura + aggregati admin), con due
-- differenze volute:
--
-- 1. **Un solo evento per visita.** Durata e profondità di scroll si fondono
--    sull'evento di atterraggio invece di vivere in tabelle separate: la
--    lezione di `article_scroll_events`, che oggi si deve ri-unire a mano.
-- 2. **Il funnel al posto dell'engagement.** Un viaggio non si commenta e non
--    si mette "mi piace": l'equivalente della reazione è l'intenzione
--    (watchlist sulle disponibilità, bozza di prenotazione aperta) e
--    l'equivalente della conversione è la richiesta di imbarco. Sono segnali
--    che il database già registra: qui si leggono soltanto.

-- 1. Eventi di visita ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.voyage_view_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voyage_id uuid NOT NULL REFERENCES public.voyages(id) ON DELETE CASCADE,
  profile_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  visitor_key text,
  lang text,
  dwell_ms integer,
  max_scroll_pct smallint,
  source text,
  medium text,
  campaign text,
  content text,
  referrer_host text,
  counted_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.voyage_view_events IS
  'Una riga per visita a una pagina viaggio: chi (profilo o visitor key), in che lingua, da dove, per quanto e fin dove ha scrollato.';
COMMENT ON COLUMN public.voyage_view_events.source IS
  'Sorgente normalizzata della visita (utm_source, click id di piattaforma o referrer classificato). "direct" quando non c''è alcun segnale.';

CREATE INDEX IF NOT EXISTS idx_voyage_view_events_voyage
  ON public.voyage_view_events (voyage_id, counted_at DESC);
CREATE INDEX IF NOT EXISTS idx_voyage_view_events_visitor_recent
  ON public.voyage_view_events (voyage_id, visitor_key, counted_at DESC);
CREATE INDEX IF NOT EXISTS idx_voyage_view_events_source
  ON public.voyage_view_events (source, counted_at DESC);

ALTER TABLE public.voyage_view_events ENABLE ROW LEVEL SECURITY;

-- Nessuna policy di INSERT: si scrive solo attraverso le RPC security definer
-- qui sotto, che validano e troncano. In lettura, chi può leggere gli
-- aggregati di traffico.
CREATE POLICY "Traffic readers read voyage view events"
  ON public.voyage_view_events FOR SELECT
  USING (public.can_read_traffic_analytics());

-- 2. Registrazione della visita ----------------------------------------------

CREATE OR REPLACE FUNCTION public.record_voyage_view(
  _voyage_id uuid,
  _visitor_key text DEFAULT NULL,
  _lang text DEFAULT NULL,
  _source text DEFAULT NULL,
  _medium text DEFAULT NULL,
  _campaign text DEFAULT NULL,
  _content text DEFAULT NULL,
  _referrer_host text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lang text := nullif(left(btrim(coalesce(_lang, '')), 8), '');
  v_visitor text := nullif(left(btrim(coalesce(_visitor_key, '')), 64), '');
  v_source text := nullif(left(btrim(lower(coalesce(_source, ''))), 60), '');
  v_medium text := nullif(left(btrim(lower(coalesce(_medium, ''))), 60), '');
  v_campaign text := nullif(left(btrim(lower(coalesce(_campaign, ''))), 60), '');
  v_content text := nullif(left(btrim(lower(coalesce(_content, ''))), 60), '');
  v_referrer text := nullif(left(btrim(lower(coalesce(_referrer_host, ''))), 120), '');
BEGIN
  -- Il viaggio deve esistere ed essere pubblico: una pagina non pubblicata la
  -- vede solo l'admin dall'anteprima, e non è traffico.
  IF NOT EXISTS (
    SELECT 1 FROM public.voyages v WHERE v.id = _voyage_id AND v.is_published
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.voyage_view_events (
    voyage_id, profile_id, visitor_key, lang, source, medium, campaign, content, referrer_host
  )
  VALUES (
    _voyage_id, auth.uid(), v_visitor, v_lang, v_source, v_medium, v_campaign, v_content, v_referrer
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_voyage_view(uuid, text, text, text, text, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.record_voyage_view(uuid, text, text, text, text, text, text, text) TO anon, authenticated;

-- 3. Durata e profondità della visita ----------------------------------------
--
-- Arrivano dopo l'atterraggio, quando la persona lascia la pagina: si fondono
-- sull'ultimo evento dello stesso visitatore entro una finestra breve,
-- tenendo sempre il valore più alto. Se quell'evento non c'è (sessione
-- ripristinata, evento perso) se ne crea uno: meglio un evento senza
-- provenienza che una durata buttata via.

CREATE OR REPLACE FUNCTION public.record_voyage_view_engagement(
  _voyage_id uuid,
  _visitor_key text DEFAULT NULL,
  _dwell_ms integer DEFAULT 0,
  _max_scroll_pct smallint DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_visitor text := nullif(left(btrim(coalesce(_visitor_key, '')), 64), '');
  v_dwell integer := greatest(0, least(coalesce(_dwell_ms, 0), 6 * 60 * 60 * 1000));
  v_scroll smallint := greatest(0, least(coalesce(_max_scroll_pct, 0), 100))::smallint;
  v_id uuid;
BEGIN
  IF v_dwell <= 0 AND v_scroll <= 0 THEN
    RETURN;
  END IF;

  SELECT id INTO v_id
  FROM public.voyage_view_events
  WHERE voyage_id = _voyage_id
    AND (
      (v_visitor IS NOT NULL AND visitor_key = v_visitor)
      OR (v_visitor IS NULL AND auth.uid() IS NOT NULL AND profile_id = auth.uid())
    )
    AND counted_at >= now() - interval '6 hours'
  ORDER BY counted_at DESC
  LIMIT 1;

  IF v_id IS NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.voyages v WHERE v.id = _voyage_id AND v.is_published
    ) THEN
      RETURN;
    END IF;

    INSERT INTO public.voyage_view_events (voyage_id, profile_id, visitor_key, dwell_ms, max_scroll_pct)
    VALUES (_voyage_id, auth.uid(), v_visitor, nullif(v_dwell, 0), nullif(v_scroll, 0)::smallint);
  ELSE
    UPDATE public.voyage_view_events
      SET dwell_ms = greatest(coalesce(dwell_ms, 0), v_dwell),
          max_scroll_pct = greatest(coalesce(max_scroll_pct, 0), v_scroll)::smallint,
          profile_id = coalesce(profile_id, auth.uid())
      WHERE id = v_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.record_voyage_view_engagement(uuid, text, integer, smallint) FROM public;
GRANT EXECUTE ON FUNCTION public.record_voyage_view_engagement(uuid, text, integer, smallint) TO anon, authenticated;

-- 4. Aggregato admin: una riga per viaggio -----------------------------------

CREATE OR REPLACE FUNCTION public.admin_voyage_view_insights()
RETURNS TABLE (
  voyage_id uuid,
  name_it text,
  name_en text,
  slug text,
  slug_it text,
  slug_en text,
  status text,
  is_published boolean,
  booking_enabled boolean,
  start_date text,
  end_date text,
  tracked_views bigint,
  registered_views bigint,
  anonymous_views bigint,
  distinct_visitors bigint,
  distinct_registered bigint,
  avg_dwell_ms numeric,
  measured_dwell_count bigint,
  avg_scroll_pct numeric,
  views_it bigint,
  views_en bigint,
  top_lang text,
  last_view_at timestamptz,
  watch_count bigint,
  draft_count bigint,
  request_count bigint,
  confirmed_count bigint
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
      e.voyage_id,
      count(*) AS tracked_views,
      count(*) FILTER (WHERE e.profile_id IS NOT NULL) AS registered_views,
      count(*) FILTER (WHERE e.profile_id IS NULL) AS anonymous_views,
      count(DISTINCT coalesce(e.profile_id::text, e.visitor_key))
        FILTER (WHERE e.profile_id IS NOT NULL OR e.visitor_key IS NOT NULL) AS distinct_visitors,
      count(DISTINCT e.profile_id) FILTER (WHERE e.profile_id IS NOT NULL) AS distinct_registered,
      avg(e.dwell_ms) FILTER (WHERE e.dwell_ms IS NOT NULL AND e.dwell_ms > 0) AS avg_dwell_ms,
      count(*) FILTER (WHERE e.dwell_ms IS NOT NULL AND e.dwell_ms > 0) AS measured_dwell_count,
      avg(e.max_scroll_pct) FILTER (WHERE e.max_scroll_pct IS NOT NULL AND e.max_scroll_pct > 0) AS avg_scroll_pct,
      count(*) FILTER (WHERE e.lang = 'it') AS views_it,
      count(*) FILTER (WHERE e.lang = 'en') AS views_en,
      max(e.counted_at) AS last_view_at
    FROM public.voyage_view_events e
    GROUP BY e.voyage_id
  ),
  watches AS (
    SELECT w.voyage_id, count(*) AS watch_count
    FROM public.voyage_availability_watches w
    WHERE w.voyage_id IS NOT NULL AND w.active
    GROUP BY w.voyage_id
  ),
  drafts AS (
    SELECT d.voyage_id, count(*) AS draft_count
    FROM public.voyage_booking_drafts d
    GROUP BY d.voyage_id
  ),
  reqs AS (
    SELECT
      r.voyage_id,
      count(*) AS request_count,
      count(*) FILTER (WHERE r.status = 'user_confirmed') AS confirmed_count
    FROM public.voyage_booking_requests r
    GROUP BY r.voyage_id
  )
  SELECT
    v.id,
    v.name_it,
    v.name_en,
    v.slug,
    v.slug_it,
    v.slug_en,
    v.status::text,
    v.is_published,
    v.booking_enabled,
    v.start_date,
    v.end_date,
    COALESCE(ev.tracked_views, 0)::bigint,
    COALESCE(ev.registered_views, 0)::bigint,
    COALESCE(ev.anonymous_views, 0)::bigint,
    COALESCE(ev.distinct_visitors, 0)::bigint,
    COALESCE(ev.distinct_registered, 0)::bigint,
    round(ev.avg_dwell_ms)::numeric,
    COALESCE(ev.measured_dwell_count, 0)::bigint,
    round(ev.avg_scroll_pct)::numeric,
    COALESCE(ev.views_it, 0)::bigint,
    COALESCE(ev.views_en, 0)::bigint,
    CASE
      WHEN COALESCE(ev.views_it, 0) = 0 AND COALESCE(ev.views_en, 0) = 0 THEN NULL
      WHEN COALESCE(ev.views_it, 0) >= COALESCE(ev.views_en, 0) THEN 'it'
      ELSE 'en'
    END,
    ev.last_view_at,
    COALESCE(watches.watch_count, 0)::bigint,
    COALESCE(drafts.draft_count, 0)::bigint,
    COALESCE(reqs.request_count, 0)::bigint,
    COALESCE(reqs.confirmed_count, 0)::bigint
  FROM public.voyages v
  LEFT JOIN ev ON ev.voyage_id = v.id
  LEFT JOIN watches ON watches.voyage_id = v.id
  LEFT JOIN drafts ON drafts.voyage_id = v.id
  LEFT JOIN reqs ON reqs.voyage_id = v.id
  WHERE v.is_published
  ORDER BY COALESCE(ev.tracked_views, 0) DESC, v.start_date DESC NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_voyage_view_insights() FROM public;
GRANT EXECUTE ON FUNCTION public.admin_voyage_view_insights() TO authenticated, service_role;

-- 5. Punteggio a cinque assi, nella stessa forma degli articoli ---------------
--
-- Le soglie non sono quelle degli articoli: una pagina viaggio è un luogo di
-- decisione, non di lettura quotidiana. Riceve meno traffico, lo tiene più a
-- lungo, e ciò che conta davvero sta in fondo al funnel.

CREATE OR REPLACE FUNCTION public.compute_voyage_score(_voyage_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_visitors_30d int;
  v_visitors_all int;
  v_avg_dwell_ms numeric;
  v_scroll_pct numeric;
  v_watch_count int;
  v_draft_count int;
  v_request_count int;
  v_confirmed_count int;
  v_intent_rate numeric;
  v_reach smallint;
  v_read smallint;
  v_react smallint;
  v_retain smallint;
  v_revenue smallint;
BEGIN
  -- Reach: visitatori unici negli ultimi 30 giorni.
  SELECT count(DISTINCT coalesce(profile_id::text, visitor_key))
  INTO v_visitors_30d
  FROM public.voyage_view_events
  WHERE voyage_id = _voyage_id
    AND counted_at >= now() - interval '30 days';

  v_reach := CASE
    WHEN v_visitors_30d > 200 THEN 2
    WHEN v_visitors_30d >= 20 THEN 1
    ELSE 0
  END;

  -- Read: quanto a lungo si resta e fin dove si arriva.
  SELECT avg(dwell_ms) INTO v_avg_dwell_ms
  FROM public.voyage_view_events
  WHERE voyage_id = _voyage_id
    AND dwell_ms > 0
    AND counted_at >= now() - interval '30 days';

  SELECT coalesce(avg(max_scroll_pct), 0) INTO v_scroll_pct
  FROM public.voyage_view_events
  WHERE voyage_id = _voyage_id
    AND max_scroll_pct > 0
    AND counted_at >= now() - interval '30 days';

  v_read := CASE
    WHEN coalesce(v_avg_dwell_ms, 0) >= 60000 AND v_scroll_pct >= 50 THEN 2
    WHEN coalesce(v_avg_dwell_ms, 0) >= 20000 OR v_scroll_pct >= 30 THEN 1
    ELSE 0
  END;

  -- React: segnali di intenzione (watchlist attive + bozze di prenotazione)
  -- ogni 100 visitatori unici. È l'equivalente di like e commenti: qualcuno si
  -- è esposto senza ancora chiedere di salire a bordo.
  SELECT count(*) INTO v_watch_count
  FROM public.voyage_availability_watches
  WHERE voyage_id = _voyage_id AND active;

  SELECT count(*) INTO v_draft_count
  FROM public.voyage_booking_drafts
  WHERE voyage_id = _voyage_id;

  v_intent_rate := CASE
    WHEN v_visitors_30d > 0 THEN (v_watch_count + v_draft_count)::numeric / v_visitors_30d * 100
    ELSE 0
  END;

  v_react := CASE
    WHEN v_visitors_30d > 0 AND v_intent_rate >= 5 THEN 2
    WHEN v_visitors_30d > 0 AND v_intent_rate >= 1 THEN 1
    ELSE 0
  END;

  -- Retain: pubblico complessivo raggiunto dalla pagina, da sempre.
  SELECT count(DISTINCT coalesce(profile_id::text, visitor_key))
  INTO v_visitors_all
  FROM public.voyage_view_events
  WHERE voyage_id = _voyage_id;

  v_retain := CASE
    WHEN v_visitors_all > 100 THEN 2
    WHEN v_visitors_all > 25 THEN 1
    ELSE 0
  END;

  -- Lead: richieste di imbarco negli ultimi 30 giorni. Qui la conversione è
  -- reale, non un proxy: qualcuno ha chiesto di partire.
  SELECT
    count(*) FILTER (WHERE requested_at >= now() - interval '30 days'),
    count(*) FILTER (WHERE status = 'user_confirmed')
  INTO v_request_count, v_confirmed_count
  FROM public.voyage_booking_requests
  WHERE voyage_id = _voyage_id;

  v_revenue := CASE
    WHEN v_request_count >= 3 THEN 2
    WHEN v_request_count >= 1 THEN 1
    ELSE 0
  END;

  RETURN jsonb_build_object(
    'reach', v_reach,
    'read', v_read,
    'react', v_react,
    'retain', v_retain,
    'revenue', v_revenue,
    'total', (v_reach + v_read + v_react + v_retain + v_revenue)::int,
    'reach_count', v_visitors_30d,
    'avg_dwell_ms', coalesce(v_avg_dwell_ms, 0)::int,
    'scroll_pct', v_scroll_pct::int,
    'watch_count', v_watch_count,
    'draft_count', v_draft_count,
    'request_count', v_request_count,
    'confirmed_count', v_confirmed_count,
    'unique_visitors', v_visitors_all
  );
END;
$$;

REVOKE ALL ON FUNCTION public.compute_voyage_score(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.compute_voyage_score(uuid) TO authenticated, service_role;

-- 6. Classifica admin dei viaggi ---------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_voyage_scores()
RETURNS TABLE (
  voyage_id uuid,
  name_it text,
  name_en text,
  slug text,
  slug_it text,
  slug_en text,
  status text,
  booking_enabled boolean,
  start_date text,
  end_date text,
  view_count bigint,
  score jsonb
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
  SELECT
    v.id,
    v.name_it,
    v.name_en,
    v.slug,
    v.slug_it,
    v.slug_en,
    v.status::text,
    v.booking_enabled,
    v.start_date,
    v.end_date,
    (
      SELECT count(*)::bigint
      FROM public.voyage_view_events e
      WHERE e.voyage_id = v.id
    ),
    public.compute_voyage_score(v.id)
  FROM public.voyages v
  WHERE v.is_published
  ORDER BY v.start_date DESC NULLS LAST, v.sort_order;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_voyage_scores() FROM public;
GRANT EXECUTE ON FUNCTION public.admin_voyage_scores() TO authenticated, service_role;
