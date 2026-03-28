DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'logbook_articles'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.logbook_articles;
  END IF;
END;
$$;
