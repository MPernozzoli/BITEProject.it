alter table public.logbook_articles
add column if not exists instagram_story_image_en text,
add column if not exists instagram_story_image_it text,
add column if not exists instagram_story_use_cover_en boolean not null default true,
add column if not exists instagram_story_use_cover_it boolean not null default true;
