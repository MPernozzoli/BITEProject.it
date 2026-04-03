alter table public.engagement_notifications
  add column if not exists read_at timestamptz null;

drop policy if exists "Users can view own engagement notifications" on public.engagement_notifications;
drop policy if exists "Users can update own engagement notifications" on public.engagement_notifications;

create policy "Users can view own engagement notifications"
  on public.engagement_notifications
  for select
  to authenticated
  using (recipient_profile_id = auth.uid());

create policy "Users can update own engagement notifications"
  on public.engagement_notifications
  for update
  to authenticated
  using (recipient_profile_id = auth.uid())
  with check (recipient_profile_id = auth.uid());
