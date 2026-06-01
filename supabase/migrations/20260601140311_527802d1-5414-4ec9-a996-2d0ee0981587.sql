-- Bilingual slugs for articles and stories.
-- The existing `slug` column stays as canonical fallback / legacy identifier.
-- slug_it / slug_en are optional per-language SEO slugs.

ALTER TABLE public.logbook_articles
  ADD COLUMN IF NOT EXISTS slug_it text,
  ADD COLUMN IF NOT EXISTS slug_en text;

ALTER TABLE public.stories
  ADD COLUMN IF NOT EXISTS slug_it text,
  ADD COLUMN IF NOT EXISTS slug_en text;

-- Uniqueness (case-insensitive, partial — allow many NULLs)
CREATE UNIQUE INDEX IF NOT EXISTS logbook_articles_slug_it_unique
  ON public.logbook_articles (lower(slug_it)) WHERE slug_it IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS logbook_articles_slug_en_unique
  ON public.logbook_articles (lower(slug_en)) WHERE slug_en IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS stories_slug_it_unique
  ON public.stories (lower(slug_it)) WHERE slug_it IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS stories_slug_en_unique
  ON public.stories (lower(slug_en)) WHERE slug_en IS NOT NULL;

-- Lookup indexes for fast slug resolution
CREATE INDEX IF NOT EXISTS logbook_articles_slug_it_idx ON public.logbook_articles (slug_it);
CREATE INDEX IF NOT EXISTS logbook_articles_slug_en_idx ON public.logbook_articles (slug_en);
CREATE INDEX IF NOT EXISTS stories_slug_it_idx ON public.stories (slug_it);
CREATE INDEX IF NOT EXISTS stories_slug_en_idx ON public.stories (slug_en);

-- Backfill: copy existing slug into the English slug (current site is largely EN-first).
-- IT slug stays NULL until an editor sets it — the lookup falls back to the canonical slug.
UPDATE public.logbook_articles
  SET slug_en = slug
  WHERE slug_en IS NULL AND slug IS NOT NULL AND slug <> '';

UPDATE public.stories
  SET slug_en = slug
  WHERE slug_en IS NULL AND slug IS NOT NULL AND slug <> '';