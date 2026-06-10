-- 1. Restrict voyages public access to published only
DROP POLICY IF EXISTS "Anyone can view voyages" ON public.voyages;
CREATE POLICY "Anyone can view published voyages"
  ON public.voyages FOR SELECT
  TO public
  USING (is_published = true);

-- 2. Restrict voyage_waypoints to those linked to a published voyage
DROP POLICY IF EXISTS "Anyone can view waypoints" ON public.voyage_waypoints;
CREATE POLICY "Anyone can view published voyage waypoints"
  ON public.voyage_waypoints FOR SELECT
  TO public
  USING (
    EXISTS (
      SELECT 1 FROM public.voyages
      WHERE voyages.id = voyage_waypoints.voyage_id
        AND voyages.is_published = true
    )
  );

-- 3. Restrict comment_mentions inserts to the comment author
DROP POLICY IF EXISTS "Authenticated can create mentions" ON public.comment_mentions;
CREATE POLICY "Users can create mentions for own comments"
  ON public.comment_mentions FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.article_comments
      WHERE article_comments.id = comment_mentions.comment_id
        AND article_comments.profile_id = auth.uid()
    )
  );

-- 4. Recreate public_profiles view with security_invoker so it does not bypass RLS
DROP VIEW IF EXISTS public.public_profiles;
CREATE VIEW public.public_profiles
WITH (security_invoker = true)
AS
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
  social_seapeople
FROM public.profiles;

GRANT SELECT ON public.public_profiles TO anon, authenticated;

-- 5. Set fixed search_path on the four pgmq wrapper functions
ALTER FUNCTION public.enqueue_email(text, jsonb) SET search_path = public, pgmq;
ALTER FUNCTION public.read_email_batch(text, integer, integer) SET search_path = public, pgmq;
ALTER FUNCTION public.delete_email(text, bigint) SET search_path = public, pgmq;
ALTER FUNCTION public.move_to_dlq(text, text, bigint, jsonb) SET search_path = public, pgmq;

-- 6. Add admin-only policies for the private hero-horizontal storage bucket
CREATE POLICY "Admins can read hero-horizontal media"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'hero-horizontal'
    AND public.has_role(auth.uid(), 'admin'::public.app_role)
  );

CREATE POLICY "Admins can upload hero-horizontal media"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'hero-horizontal'
    AND public.has_role(auth.uid(), 'admin'::public.app_role)
  );

CREATE POLICY "Admins can update hero-horizontal media"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'hero-horizontal'
    AND public.has_role(auth.uid(), 'admin'::public.app_role)
  );

CREATE POLICY "Admins can delete hero-horizontal media"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'hero-horizontal'
    AND public.has_role(auth.uid(), 'admin'::public.app_role)
  );