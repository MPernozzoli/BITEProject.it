
-- Tags table
CREATE TABLE public.tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view tags" ON public.tags FOR SELECT TO public USING (true);
CREATE POLICY "Authenticated can manage tags" ON public.tags FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Article-tags junction
CREATE TABLE public.article_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid NOT NULL REFERENCES public.logbook_articles(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
  UNIQUE(article_id, tag_id)
);

ALTER TABLE public.article_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view article tags" ON public.article_tags FOR SELECT TO public USING (true);
CREATE POLICY "Authenticated can manage article tags" ON public.article_tags FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Stories table
CREATE TABLE public.stories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title_en text NOT NULL DEFAULT '',
  title_it text NOT NULL DEFAULT '',
  description_en text DEFAULT '',
  description_it text DEFAULT '',
  slug text NOT NULL UNIQUE,
  cover_image text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.stories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view stories" ON public.stories FOR SELECT TO public USING (true);
CREATE POLICY "Authenticated can manage stories" ON public.stories FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Add story reference to articles
ALTER TABLE public.logbook_articles ADD COLUMN story_id uuid REFERENCES public.stories(id) ON DELETE SET NULL DEFAULT NULL;

-- Story subscriptions
CREATE TABLE public.story_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id uuid NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(story_id, profile_id)
);

ALTER TABLE public.story_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own subscriptions" ON public.story_subscriptions FOR SELECT TO authenticated USING (auth.uid() = profile_id);
CREATE POLICY "Users can subscribe" ON public.story_subscriptions FOR INSERT TO authenticated WITH CHECK (auth.uid() = profile_id);
CREATE POLICY "Users can unsubscribe" ON public.story_subscriptions FOR DELETE TO authenticated USING (auth.uid() = profile_id);
