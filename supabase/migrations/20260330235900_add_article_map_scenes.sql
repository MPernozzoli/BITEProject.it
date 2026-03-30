alter table public.logbook_articles
add column if not exists article_map_scenes jsonb;
