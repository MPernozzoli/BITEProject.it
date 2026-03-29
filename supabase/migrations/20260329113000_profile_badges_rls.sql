DROP POLICY IF EXISTS "Authenticated can manage badges" ON public.profile_badges;

CREATE POLICY "Users can insert own badges"
  ON public.profile_badges
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = profile_id);

CREATE POLICY "Users can update own badges"
  ON public.profile_badges
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = profile_id)
  WITH CHECK (auth.uid() = profile_id);

CREATE POLICY "Users can delete own badges"
  ON public.profile_badges
  FOR DELETE
  TO authenticated
  USING (auth.uid() = profile_id);

CREATE POLICY "Service role can manage badges"
  ON public.profile_badges
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
