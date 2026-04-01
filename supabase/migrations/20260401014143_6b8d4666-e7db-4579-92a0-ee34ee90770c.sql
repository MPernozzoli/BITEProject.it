-- Fix: Restrict profiles SELECT to only authenticated users (email is sensitive)
-- The public_profiles view (which omits email) remains accessible to everyone
DROP POLICY IF EXISTS "Anyone can view profiles" ON public.profiles;

CREATE POLICY "Authenticated users can view profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (true);

-- Allow anon to read via public_profiles view only (already exists, no email column)