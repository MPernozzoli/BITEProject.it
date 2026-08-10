-- Human-readable, per-language slugs for voyages, mirroring the
-- logbook_articles / stories bilingual slug pattern (20260601140311).
-- `slug` is the canonical / legacy fallback (always present, unique).
-- `slug_it` and `slug_en` are optional per-language SEO slugs.
--
-- Public voyage URLs move from /voyages/<uuid>--<slug> to /voyages/<slug>;
-- VoyagePage.tsx handles the redirect from old links at request time.

CREATE OR REPLACE FUNCTION public.slugify_text(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    NULLIF(
      regexp_replace(
        regexp_replace(
          lower(
            translate(
              value,
              'àáâãäåèéêëìíîïòóôõöùúûüñçÀÁÂÃÄÅÈÉÊËÌÍÎÏÒÓÔÕÖÙÚÛÜÑÇ',
              'aaaaaaeeeeiiiiooooouuuuncAAAAAAEEEEIIIIOOOOOUUUUNC'
            )
          ),
          '[^a-z0-9]+', '-', 'g'
        ),
        '(^-+|-+$)', '', 'g'
      ),
      ''
    ),
    'voyage'
  );
$$;

ALTER TABLE public.voyages
  ADD COLUMN IF NOT EXISTS slug text,
  ADD COLUMN IF NOT EXISTS slug_it text,
  ADD COLUMN IF NOT EXISTS slug_en text;

-- Backfill: canonical slug from the best available name, then per-language
-- slugs where the localized name exists. Each pass dedupes against itself by
-- appending -2, -3, ... in created_at order.
DO $$
DECLARE
  r RECORD;
  base_slug text;
  candidate text;
  suffix int;
BEGIN
  FOR r IN SELECT id, name, name_it, name_en FROM public.voyages WHERE slug IS NULL ORDER BY created_at ASC LOOP
    base_slug := public.slugify_text(COALESCE(NULLIF(trim(r.name_en), ''), NULLIF(trim(r.name_it), ''), r.name, 'voyage'));
    candidate := base_slug;
    suffix := 2;
    WHILE EXISTS (SELECT 1 FROM public.voyages WHERE slug = candidate AND id <> r.id) LOOP
      candidate := base_slug || '-' || suffix;
      suffix := suffix + 1;
    END LOOP;
    UPDATE public.voyages SET slug = candidate WHERE id = r.id;
  END LOOP;

  FOR r IN SELECT id, name_it FROM public.voyages WHERE slug_it IS NULL AND name_it IS NOT NULL AND trim(name_it) <> '' ORDER BY created_at ASC LOOP
    base_slug := public.slugify_text(r.name_it);
    candidate := base_slug;
    suffix := 2;
    WHILE EXISTS (SELECT 1 FROM public.voyages WHERE slug_it = candidate AND id <> r.id) LOOP
      candidate := base_slug || '-' || suffix;
      suffix := suffix + 1;
    END LOOP;
    UPDATE public.voyages SET slug_it = candidate WHERE id = r.id;
  END LOOP;

  FOR r IN SELECT id, name_en FROM public.voyages WHERE slug_en IS NULL AND name_en IS NOT NULL AND trim(name_en) <> '' ORDER BY created_at ASC LOOP
    base_slug := public.slugify_text(r.name_en);
    candidate := base_slug;
    suffix := 2;
    WHILE EXISTS (SELECT 1 FROM public.voyages WHERE slug_en = candidate AND id <> r.id) LOOP
      candidate := base_slug || '-' || suffix;
      suffix := suffix + 1;
    END LOOP;
    UPDATE public.voyages SET slug_en = candidate WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE public.voyages ALTER COLUMN slug SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS voyages_slug_unique
  ON public.voyages (lower(slug));
CREATE UNIQUE INDEX IF NOT EXISTS voyages_slug_it_unique
  ON public.voyages (lower(slug_it)) WHERE slug_it IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS voyages_slug_en_unique
  ON public.voyages (lower(slug_en)) WHERE slug_en IS NOT NULL;
CREATE INDEX IF NOT EXISTS voyages_slug_it_idx ON public.voyages (slug_it);
CREATE INDEX IF NOT EXISTS voyages_slug_en_idx ON public.voyages (slug_en);
