DROP POLICY IF EXISTS "Anyone can view profiles" ON public.profiles;

CREATE POLICY "Users can view own profile"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

REVOKE SELECT ON public.profiles FROM anon;

CREATE OR REPLACE VIEW public.public_profiles AS
SELECT
  id,
  name,
  avatar_url,
  bio,
  created_at,
  preferred_language,
  secondary_language,
  social_instagram,
  social_youtube,
  social_tiktok,
  social_facebook,
  social_x,
  social_linkedin,
  social_website
FROM public.profiles;

REVOKE ALL ON public.public_profiles FROM PUBLIC;
GRANT SELECT ON public.public_profiles TO anon, authenticated;
