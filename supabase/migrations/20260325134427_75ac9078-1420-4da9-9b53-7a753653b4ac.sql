ALTER TABLE public.profiles
  ADD COLUMN preferred_language text NOT NULL DEFAULT 'it',
  ADD COLUMN secondary_language text NULL;