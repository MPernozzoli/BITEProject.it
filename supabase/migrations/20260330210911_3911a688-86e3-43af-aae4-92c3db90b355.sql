-- 1. Fix: Revoke email column access from anon role to prevent email harvesting
-- Keep public SELECT on profiles for names/avatars but hide email
REVOKE SELECT(email) ON public.profiles FROM anon;

-- 2. Fix: Remove user self-award badge policies (keep service_role + delete own)
DROP POLICY IF EXISTS "Users can insert own badges" ON public.profile_badges;
DROP POLICY IF EXISTS "Users can update own badges" ON public.profile_badges;

-- Add admin insert/update policies for badges
CREATE POLICY "Admins can manage badges"
  ON public.profile_badges FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- 3. Fix: Restrict storage write policies to admins only
-- Drop overly permissive storage policies
DROP POLICY IF EXISTS "Auth users can upload media" ON storage.objects;
DROP POLICY IF EXISTS "Auth users can update media" ON storage.objects;
DROP POLICY IF EXISTS "Auth users can delete media" ON storage.objects;
DROP POLICY IF EXISTS "Auth users can upload homepage media" ON storage.objects;
DROP POLICY IF EXISTS "Auth users can update homepage media" ON storage.objects;
DROP POLICY IF EXISTS "Auth users can delete homepage media" ON storage.objects;

-- Re-create with admin-only checks for logbook-media
CREATE POLICY "Admins can upload logbook media"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'logbook-media' AND (SELECT public.has_role(auth.uid(), 'admin'::app_role)));

CREATE POLICY "Admins can update logbook media"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'logbook-media' AND (SELECT public.has_role(auth.uid(), 'admin'::app_role)));

CREATE POLICY "Admins can delete logbook media"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'logbook-media' AND (SELECT public.has_role(auth.uid(), 'admin'::app_role)));

-- Re-create with admin-only checks for homepage-media
CREATE POLICY "Admins can upload homepage media"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'homepage-media' AND (SELECT public.has_role(auth.uid(), 'admin'::app_role)));

CREATE POLICY "Admins can update homepage media"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'homepage-media' AND (SELECT public.has_role(auth.uid(), 'admin'::app_role)));

CREATE POLICY "Admins can delete homepage media"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'homepage-media' AND (SELECT public.has_role(auth.uid(), 'admin'::app_role)));