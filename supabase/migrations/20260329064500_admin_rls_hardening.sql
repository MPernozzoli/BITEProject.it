DROP POLICY IF EXISTS "Authenticated users can manage articles" ON public.logbook_articles;
CREATE POLICY "Admins can manage articles"
  ON public.logbook_articles
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Authenticated can manage article authors" ON public.article_authors;
CREATE POLICY "Admins can manage article authors"
  ON public.article_authors
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Authenticated can manage tags" ON public.tags;
CREATE POLICY "Admins can manage tags"
  ON public.tags
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Authenticated can manage article tags" ON public.article_tags;
CREATE POLICY "Admins can manage article tags"
  ON public.article_tags
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Authenticated can manage stories" ON public.stories;
CREATE POLICY "Admins can manage stories"
  ON public.stories
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
