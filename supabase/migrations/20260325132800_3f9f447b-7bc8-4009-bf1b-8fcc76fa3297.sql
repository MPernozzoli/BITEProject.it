
CREATE TABLE public.newsletter_subscribers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  email text NOT NULL,
  subscribed boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(profile_id)
);

ALTER TABLE public.newsletter_subscribers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view own subscription" ON public.newsletter_subscribers FOR SELECT TO authenticated USING (auth.uid() = profile_id);
CREATE POLICY "Users can insert own subscription" ON public.newsletter_subscribers FOR INSERT TO authenticated WITH CHECK (auth.uid() = profile_id);
CREATE POLICY "Users can update own subscription" ON public.newsletter_subscribers FOR UPDATE TO authenticated USING (auth.uid() = profile_id) WITH CHECK (auth.uid() = profile_id);

CREATE TRIGGER update_newsletter_updated_at BEFORE UPDATE ON public.newsletter_subscribers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
