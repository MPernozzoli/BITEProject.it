-- Fix: Restrict profiles SELECT to own row + admin access only
-- This prevents any authenticated user from reading all other users' emails

DROP POLICY IF EXISTS "Authenticated users can view profiles" ON public.profiles;

-- Users can only read their own profile
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() = id);

-- Admins can read all profiles (needed for admin dashboard)
CREATE POLICY "Admins can view all profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));