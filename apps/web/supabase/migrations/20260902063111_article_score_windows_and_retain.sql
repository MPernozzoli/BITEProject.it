-- Punteggio articoli: finestra unica, Retain che misura davvero il ritorno,
-- soglie tarate sul traffico reale.
--
-- Tre difetti del calcolo precedente (20260824000004):
--
-- 1. React divideva reazioni *all-time* per lettori unici *degli ultimi 30
--    giorni*. Numeratore e denominatore su periodi diversi: invecchiando
--    l'articolo il denominatore cala e il tasso sale da solo, premiando
--    l'anzianita' invece del contenuto.
--
-- 2. Retain era `count(distinct lettori) all-time`, cioe' di nuovo la
--    dimensione del pubblico: quasi collineare con Reach, e per un articolo
--    vecchio cresce anche se nessuno e' mai tornato. Ritorno vero, per un
--    diario di bordo, significa un'altra cosa: quel pezzo ha trasformato un
--    visitatore in un lettore del diario. Si misura come quota dei suoi
--    lettori che nella stessa finestra ha letto almeno un altro articolo.
--
-- 3. Le soglie erano tarate per un sito molto piu' grande (Reach 50/500 con un
--    massimo reale di 57 lettori, Retain >200): due assi di fatto binari.
--
-- Read e Lead restano invariati: dipendono da `article_scroll_events` e
-- `article_click_events`, che hanno iniziato a riempirsi solo ora. Tarare
-- quelle soglie adesso significherebbe sceglierle a caso.

CREATE OR REPLACE FUNCTION public.compute_article_score(_article_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Ogni asse guarda questa finestra, numeratori e denominatori compresi.
  v_window interval := interval '30 days';
  -- Sotto questa base un tasso e' rumore: con 8 lettori un solo like sposta la
  -- percentuale di dodici punti. Gli assi a tasso si fermano allora a 1, che e'
  -- il modo onesto di dire "promettente, ma non ancora misurabile".
  v_min_base int := 10;

  v_readers int;
  v_avg_dwell_ms numeric;
  v_scroll_pct numeric;
  v_like_count int;
  v_comment_count int;
  v_share_count int;
  v_click_count int;
  v_returning int;
  v_retain_pct numeric;
  v_react_rate numeric;
  v_unique_readers int;

  v_reach smallint;
  v_read_score smallint;
  v_react smallint;
  v_retain smallint;
  v_revenue smallint;
BEGIN
  -- Reach -------------------------------------------------------------------
  SELECT count(DISTINCT coalesce(profile_id::text, visitor_key))
  INTO v_readers
  FROM public.article_read_events
  WHERE article_id = _article_id
    AND counted_at >= now() - v_window
    AND coalesce(profile_id::text, visitor_key) IS NOT NULL;

  v_reach := CASE
    WHEN v_readers >= 50 THEN 2
    WHEN v_readers >= 15 THEN 1
    ELSE 0
  END;

  -- Read (invariato: in attesa che lo scroll accumuli storia) ----------------
  SELECT avg(dwell_ms) INTO v_avg_dwell_ms
  FROM public.article_read_events
  WHERE article_id = _article_id
    AND dwell_ms > 0
    AND counted_at >= now() - v_window;

  SELECT coalesce(avg(max_scroll_pct), 0) INTO v_scroll_pct
  FROM public.article_scroll_events
  WHERE article_id = _article_id
    AND created_at >= now() - v_window;

  v_read_score := CASE
    WHEN coalesce(v_avg_dwell_ms, 0) >= 90000 AND v_scroll_pct >= 50 THEN 2
    WHEN coalesce(v_avg_dwell_ms, 0) >= 30000 OR v_scroll_pct >= 30 THEN 1
    ELSE 0
  END;

  -- React: reazioni della finestra su lettori della finestra -----------------
  SELECT count(*) INTO v_like_count
  FROM public.article_likes
  WHERE article_id = _article_id AND created_at >= now() - v_window;

  SELECT count(*) INTO v_comment_count
  FROM public.article_comments
  WHERE article_id = _article_id AND created_at >= now() - v_window;

  SELECT count(*) INTO v_share_count
  FROM public.article_share_events
  WHERE article_id = _article_id AND created_at >= now() - v_window;

  v_react_rate := CASE
    WHEN v_readers > 0
      THEN (v_like_count + v_comment_count + v_share_count)::numeric / v_readers * 100
    ELSE 0
  END;

  v_react := CASE
    WHEN v_readers >= v_min_base AND v_react_rate >= 10 THEN 2
    WHEN v_react_rate >= 3 THEN 1
    ELSE 0
  END;

  -- Retain: chi ha letto questo pezzo ed e' andato oltre ---------------------
  SELECT count(*) INTO v_returning
  FROM (
    SELECT e.reader
    FROM (
      SELECT coalesce(profile_id::text, visitor_key) AS reader, article_id
      FROM public.article_read_events
      WHERE counted_at >= now() - v_window
        AND coalesce(profile_id::text, visitor_key) IS NOT NULL
    ) e
    GROUP BY e.reader
    HAVING count(DISTINCT e.article_id) >= 2
       AND bool_or(e.article_id = _article_id)
  ) t;

  v_retain_pct := CASE WHEN v_readers > 0 THEN v_returning::numeric / v_readers * 100 ELSE 0 END;

  v_retain := CASE
    WHEN v_readers >= v_min_base AND v_retain_pct >= 60 THEN 2
    WHEN v_retain_pct >= 30 THEN 1
    ELSE 0
  END;

  -- Lead (invariato: in attesa che i click accumulino storia) ----------------
  SELECT count(*) INTO v_click_count
  FROM public.article_click_events
  WHERE article_id = _article_id
    AND created_at >= now() - v_window;

  v_revenue := CASE
    WHEN v_click_count >= 10 THEN 2
    WHEN v_click_count >= 3 THEN 1
    ELSE 0
  END;

  -- Il pubblico storico non e' piu' un asse, ma resta un numero utile da vedere.
  SELECT count(DISTINCT coalesce(profile_id::text, visitor_key))
  INTO v_unique_readers
  FROM public.article_read_events
  WHERE article_id = _article_id
    AND coalesce(profile_id::text, visitor_key) IS NOT NULL;

  RETURN jsonb_build_object(
    'reach', v_reach,
    'read', v_read_score,
    'react', v_react,
    'retain', v_retain,
    'revenue', v_revenue,
    'total', (v_reach + v_read_score + v_react + v_retain + v_revenue)::int,
    'reach_count', v_readers,
    'avg_dwell_ms', coalesce(v_avg_dwell_ms, 0)::int,
    'scroll_pct', v_scroll_pct::int,
    'like_count', v_like_count,
    'comment_count', v_comment_count,
    'share_count', v_share_count,
    'click_count', v_click_count,
    'returning_readers', v_returning,
    'retain_pct', round(v_retain_pct)::int,
    'unique_readers', v_unique_readers
  );
END;
$$;

COMMENT ON FUNCTION public.compute_article_score(uuid) IS
  'Punteggio 5 assi (0-2 ciascuno) su finestra di 30 giorni. Retain = quota di lettori che nella stessa finestra ha letto anche un altro articolo. Gli assi a tasso (React, Retain) si fermano a 1 sotto i 10 lettori.';

GRANT EXECUTE ON FUNCTION public.compute_article_score(uuid) TO anon, authenticated;
