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
  social_website,
  social_seapeople,
  public.has_role(id, 'admin') AS is_admin
FROM public.profiles;
