INSERT INTO storage.buckets (id, name, public)
VALUES ('homepage-media', 'homepage-media', true)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Homepage media is public'
  ) THEN
    CREATE POLICY "Homepage media is public"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'homepage-media');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Auth users can upload homepage media'
  ) THEN
    CREATE POLICY "Auth users can upload homepage media"
      ON storage.objects FOR INSERT
      TO authenticated
      WITH CHECK (bucket_id = 'homepage-media');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Auth users can update homepage media'
  ) THEN
    CREATE POLICY "Auth users can update homepage media"
      ON storage.objects FOR UPDATE
      TO authenticated
      USING (bucket_id = 'homepage-media');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Auth users can delete homepage media'
  ) THEN
    CREATE POLICY "Auth users can delete homepage media"
      ON storage.objects FOR DELETE
      TO authenticated
      USING (bucket_id = 'homepage-media');
  END IF;
END
$$;
