-- Punteggio viaggi: stessi due difetti strutturali gia' corretti sugli
-- articoli in 20260902063111, con una differenza di calibrazione.
--
-- 1. React divideva watchlist e bozze contate *da sempre* per i visitatori
--    unici *degli ultimi 30 giorni*: numeratore e denominatore su periodi
--    diversi, quindi un tasso che sale da solo con l'invecchiare della pagina.
--
-- 2. Retain era `count(distinct visitatori) all-time`, cioe' di nuovo la
--    dimensione del pubblico. Su questa tabella il difetto e' perfino visibile
--    a occhio nudo: `voyage_view_events` esiste dal 30/08/2026, quindi oggi
--    "da sempre" e "ultimi 30 giorni" sono lo stesso insieme e Retain e'
--    letteralmente una copia di Reach.
--
--    Per una pagina viaggio il ritorno vero e' un'altra cosa: decidere di
--    salire a bordo costa, e chi ci pensa davvero torna a guardare un altro
--    giorno. Retain diventa quindi la quota di visitatori tornati in una
--    giornata diversa.
--
-- Le soglie di Reach e Lead restano quelle di 20260830150000: con 155
-- visitatori raccolti in tre giorni sulla pagina piu' vista, la soglia dei 200
-- e' aspirazionale ma raggiungibile, e non c'e' motivo di toccarla.
--
-- Le soglie di Retain (15% / 5%) sono invece provvisorie per forza: tre giorni
-- di storia e una sola pagina con traffico vero non permettono di tararle su
-- niente. Vanno riviste quando `voyage_view_events` avra' qualche settimana.

CREATE OR REPLACE FUNCTION public.compute_voyage_score(_voyage_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Ogni asse guarda questa finestra, numeratori e denominatori compresi.
  v_window interval := interval '30 days';
  -- Sotto questa base un tasso e' rumore, non merito: gli assi a tasso si
  -- fermano allora a 1.
  v_min_base int := 10;

  v_visitors_30d int;
  v_visitors_all int;
  v_avg_dwell_ms numeric;
  v_scroll_pct numeric;
  v_watch_count int;
  v_draft_count int;
  v_request_count int;
  v_confirmed_count int;
  v_returning int;
  v_retain_pct numeric;
  v_intent_rate numeric;
  v_reach smallint;
  v_read smallint;
  v_react smallint;
  v_retain smallint;
  v_revenue smallint;
BEGIN
  -- Reach: visitatori unici nella finestra.
  SELECT count(DISTINCT coalesce(profile_id::text, visitor_key))
  INTO v_visitors_30d
  FROM public.voyage_view_events
  WHERE voyage_id = _voyage_id
    AND counted_at >= now() - v_window
    AND coalesce(profile_id::text, visitor_key) IS NOT NULL;

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
    AND counted_at >= now() - v_window;

  SELECT coalesce(avg(max_scroll_pct), 0) INTO v_scroll_pct
  FROM public.voyage_view_events
  WHERE voyage_id = _voyage_id
    AND max_scroll_pct > 0
    AND counted_at >= now() - v_window;

  v_read := CASE
    WHEN coalesce(v_avg_dwell_ms, 0) >= 60000 AND v_scroll_pct >= 50 THEN 2
    WHEN coalesce(v_avg_dwell_ms, 0) >= 20000 OR v_scroll_pct >= 30 THEN 1
    ELSE 0
  END;

  -- React: segnali di intenzione nati nella finestra (watchlist ancora attive
  -- e bozze di prenotazione) ogni 100 visitatori della stessa finestra.
  SELECT count(*) INTO v_watch_count
  FROM public.voyage_availability_watches
  WHERE voyage_id = _voyage_id
    AND active
    AND created_at >= now() - v_window;

  SELECT count(*) INTO v_draft_count
  FROM public.voyage_booking_drafts
  WHERE voyage_id = _voyage_id
    AND created_at >= now() - v_window;

  v_intent_rate := CASE
    WHEN v_visitors_30d > 0 THEN (v_watch_count + v_draft_count)::numeric / v_visitors_30d * 100
    ELSE 0
  END;

  v_react := CASE
    WHEN v_visitors_30d >= v_min_base AND v_intent_rate >= 5 THEN 2
    WHEN v_intent_rate >= 1 THEN 1
    ELSE 0
  END;

  -- Retain: chi e' tornato a guardare in una giornata diversa.
  SELECT count(*) INTO v_returning
  FROM (
    SELECT coalesce(profile_id::text, visitor_key) AS visitor
    FROM public.voyage_view_events
    WHERE voyage_id = _voyage_id
      AND counted_at >= now() - v_window
      AND coalesce(profile_id::text, visitor_key) IS NOT NULL
    GROUP BY 1
    HAVING count(DISTINCT date_trunc('day', counted_at)) >= 2
  ) t;

  v_retain_pct := CASE
    WHEN v_visitors_30d > 0 THEN v_returning::numeric / v_visitors_30d * 100
    ELSE 0
  END;

  v_retain := CASE
    WHEN v_visitors_30d >= v_min_base AND v_retain_pct >= 15 THEN 2
    WHEN v_retain_pct >= 5 THEN 1
    ELSE 0
  END;

  -- Lead: richieste di imbarco nella finestra. Qui la conversione e' reale,
  -- non un proxy: qualcuno ha chiesto di partire.
  SELECT
    count(*) FILTER (WHERE requested_at >= now() - v_window),
    count(*) FILTER (WHERE status = 'user_confirmed')
  INTO v_request_count, v_confirmed_count
  FROM public.voyage_booking_requests
  WHERE voyage_id = _voyage_id;

  v_revenue := CASE
    WHEN v_request_count >= 3 THEN 2
    WHEN v_request_count >= 1 THEN 1
    ELSE 0
  END;

  -- Il pubblico storico non e' piu' un asse, ma resta un numero da vedere.
  SELECT count(DISTINCT coalesce(profile_id::text, visitor_key))
  INTO v_visitors_all
  FROM public.voyage_view_events
  WHERE voyage_id = _voyage_id
    AND coalesce(profile_id::text, visitor_key) IS NOT NULL;

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
    'returning_visitors', v_returning,
    'retain_pct', round(v_retain_pct)::int,
    'unique_visitors', v_visitors_all
  );
END;
$$;

COMMENT ON FUNCTION public.compute_voyage_score(uuid) IS
  'Punteggio 5 assi (0-2 ciascuno) su finestra di 30 giorni. Retain = quota di visitatori tornati in una giornata diversa. Gli assi a tasso (React, Retain) si fermano a 1 sotto i 10 visitatori.';

REVOKE ALL ON FUNCTION public.compute_voyage_score(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.compute_voyage_score(uuid) TO authenticated, service_role;
