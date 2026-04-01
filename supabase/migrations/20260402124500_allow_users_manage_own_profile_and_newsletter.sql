alter table public.profiles enable row level security;
alter table public.newsletter_subscribers enable row level security;
alter table public.email_notification_preferences enable row level security;

drop policy if exists "Users can insert own profile" on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;
drop policy if exists "Users can view own newsletter subscriber row" on public.newsletter_subscribers;
drop policy if exists "Users can insert own newsletter subscriber row" on public.newsletter_subscribers;
drop policy if exists "Users can update own newsletter subscriber row" on public.newsletter_subscribers;
drop policy if exists "Users can view own email notification preferences" on public.email_notification_preferences;
drop policy if exists "Users can insert own email notification preferences" on public.email_notification_preferences;
drop policy if exists "Users can update own email notification preferences" on public.email_notification_preferences;

create policy "Users can insert own profile"
  on public.profiles
  for insert
  to authenticated
  with check (
    auth.uid() = id
    and lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

create policy "Users can update own profile"
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    and lower(email) = lower(coalesce(auth.jwt() ->> 'email', email))
  );

create policy "Users can view own newsletter subscriber row"
  on public.newsletter_subscribers
  for select
  to authenticated
  using (
    profile_id = auth.uid()
    or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

create policy "Users can insert own newsletter subscriber row"
  on public.newsletter_subscribers
  for insert
  to authenticated
  with check (
    profile_id = auth.uid()
    or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

create policy "Users can update own newsletter subscriber row"
  on public.newsletter_subscribers
  for update
  to authenticated
  using (
    profile_id = auth.uid()
    or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
  with check (
    profile_id = auth.uid()
    or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

create policy "Users can view own email notification preferences"
  on public.email_notification_preferences
  for select
  to authenticated
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

create policy "Users can insert own email notification preferences"
  on public.email_notification_preferences
  for insert
  to authenticated
  with check (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

create policy "Users can update own email notification preferences"
  on public.email_notification_preferences
  for update
  to authenticated
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')))
  with check (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
