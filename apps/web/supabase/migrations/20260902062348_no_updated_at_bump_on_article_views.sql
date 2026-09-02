-- Una lettura non e' una modifica editoriale.
--
-- `increment_article_view_count` incrementa `view_count`, e l'UPDATE fa
-- scattare il trigger `set_updated_at` che riscrive `updated_at = now()`.
-- `scripts/generate-sitemap.mjs` prende da li' il `<lastmod>` di ogni articolo:
-- il risultato e' che per i crawler ogni articolo risulta riscritto a ogni
-- visita di un lettore.
--
-- Il problema era gia' stato affrontato in 20260823130000, disattivando i
-- trigger dentro l'RPC con `session_replication_role`. Quella riga e' andata
-- persa in 20260830094858, che ha ridefinito l'RPC per aggiungere
-- l'attribuzione della sorgente di traffico. Rimetterla nell'RPC significa
-- lasciarla esposta alla prossima riscrittura, quindi la regola si sposta dove
-- appartiene: nel trigger della tabella, che vale per qualunque percorso di
-- scrittura, oggi e domani.
--
-- La funzione condivisa `update_updated_at_column()` non si tocca: la usano
-- 24 trigger su altrettante tabelle. Qui serve solo a `logbook_articles`, che
-- prende quindi la propria.

CREATE OR REPLACE FUNCTION public.logbook_articles_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Se dell'intera riga e' cambiato solo il contatore delle visite, la data di
  -- ultima modifica resta quella dell'ultima stesura. Il confronto e' sull'
  -- intera riga, e non su un elenco di colonne, perche' cosi' regge l'aggiunta
  -- di colonne future senza che nessuno debba ricordarsene.
  IF to_jsonb(NEW) - 'view_count' - 'updated_at'
       IS NOT DISTINCT FROM
     to_jsonb(OLD) - 'view_count' - 'updated_at'
  THEN
    NEW.updated_at := OLD.updated_at;
    RETURN NEW;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.logbook_articles_touch_updated_at() IS
  'Aggiorna updated_at solo per modifiche editoriali: un incremento di view_count da solo non conta (la sitemap ne ricava lastmod).';

DROP TRIGGER IF EXISTS set_updated_at ON public.logbook_articles;

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.logbook_articles
  FOR EACH ROW
  EXECUTE FUNCTION public.logbook_articles_touch_updated_at();
