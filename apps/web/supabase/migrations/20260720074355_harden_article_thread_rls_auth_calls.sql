drop policy if exists "Users insert own comments" on public.article_comments;
create policy "Users insert own comments"
  on public.article_comments for insert
  to authenticated
  with check (profile_id = (select auth.uid()));

drop policy if exists "Users update own comments" on public.article_comments;
create policy "Users update own comments"
  on public.article_comments for update
  to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

drop policy if exists "Users delete own comments" on public.article_comments;
create policy "Users delete own comments"
  on public.article_comments for delete
  to authenticated
  using (
    profile_id = (select auth.uid())
    or public.has_role((select auth.uid()), 'admin'::public.app_role)
    or public.has_role((select auth.uid()), 'moderator'::public.app_role)
  );

drop policy if exists "Users insert own comment_likes" on public.comment_likes;
create policy "Users insert own comment_likes"
  on public.comment_likes for insert
  to authenticated
  with check (profile_id = (select auth.uid()));

drop policy if exists "Users delete own comment_likes" on public.comment_likes;
create policy "Users delete own comment_likes"
  on public.comment_likes for delete
  to authenticated
  using (profile_id = (select auth.uid()));
