ALTER TABLE public.voyages
  ADD COLUMN IF NOT EXISTS name_it text,
  ADD COLUMN IF NOT EXISTS name_en text,
  ADD COLUMN IF NOT EXISTS description_it text,
  ADD COLUMN IF NOT EXISTS description_en text;

UPDATE public.voyages
SET
  name_it = COALESCE(NULLIF(name_it, ''), NULLIF(name, ''), name_it),
  name_en = COALESCE(NULLIF(name_en, ''), NULLIF(name, ''), name_en),
  description_it = COALESCE(NULLIF(description_it, ''), NULLIF(description, ''), description_it),
  description_en = COALESCE(NULLIF(description_en, ''), NULLIF(description, ''), description_en);
