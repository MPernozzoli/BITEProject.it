-- Abilita REPLICA IDENTITY FULL per ricevere il payload completo nei messaggi realtime
ALTER TABLE public.engagement_notifications REPLICA IDENTITY FULL;
-- Aggiungi la tabella alla pubblicazione realtime (idempotente)
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.engagement_notifications;
  EXCEPTION
    WHEN duplicate_object THEN
      NULL;
  END;
END $$;
-- Rimuovi logbook_articles dalla pubblicazione realtime: il view_count è ora aggiornato
-- via polling lazy lato client, evitando il costo di una connessione realtime per ogni lettore.
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.logbook_articles;
  EXCEPTION
    WHEN undefined_object THEN
      NULL;
    WHEN OTHERS THEN
      NULL;
  END;
END $$;
