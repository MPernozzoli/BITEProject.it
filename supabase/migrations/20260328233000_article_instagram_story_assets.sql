ALTER TABLE public.logbook_articles
  ADD COLUMN instagram_story_use_cover_en boolean NOT NULL DEFAULT true,
  ADD COLUMN instagram_story_use_cover_it boolean NOT NULL DEFAULT true,
  ADD COLUMN instagram_story_image_en text NULL,
  ADD COLUMN instagram_story_image_it text NULL;
