-- Add story_sort_order to logbook_articles for manual chapter ordering within stories.
-- Default 0 so existing rows sort before any explicitly ordered ones.

ALTER TABLE public.logbook_articles
  ADD COLUMN IF NOT EXISTS story_sort_order integer not null default 0;

-- Backfill: assign sequential order per story based on published_at for existing linked articles.
-- This gives existing stories a sensible initial order.

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY story_id
           ORDER BY published_at ASC NULLS FIRST, created_at ASC
         ) - 1 AS rn
  FROM public.logbook_articles
  WHERE story_id IS NOT NULL
)
UPDATE public.logbook_articles a
SET story_sort_order = ranked.rn
FROM ranked
WHERE a.id = ranked.id;
