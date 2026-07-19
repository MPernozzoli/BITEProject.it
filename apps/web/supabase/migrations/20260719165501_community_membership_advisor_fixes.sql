alter function public.touch_updated_at() set search_path = public;

drop policy if exists "Admins manage membership tiers" on public.membership_tiers;
drop policy if exists "Admins manage subscriptions" on public.membership_subscriptions;
drop policy if exists "Admins manage membership payments" on public.membership_payments;
drop policy if exists "Admins manage benefit events" on public.membership_benefit_events;
drop policy if exists "Admins manage community posts" on public.community_posts;
drop policy if exists "Admins manage community live events" on public.community_live_events;

drop policy if exists "Admins insert membership tiers" on public.membership_tiers;
drop policy if exists "Admins update membership tiers" on public.membership_tiers;
drop policy if exists "Admins delete membership tiers" on public.membership_tiers;
drop policy if exists "Admins insert subscriptions" on public.membership_subscriptions;
drop policy if exists "Admins update subscriptions" on public.membership_subscriptions;
drop policy if exists "Admins delete subscriptions" on public.membership_subscriptions;
drop policy if exists "Admins insert membership payments" on public.membership_payments;
drop policy if exists "Admins update membership payments" on public.membership_payments;
drop policy if exists "Admins delete membership payments" on public.membership_payments;
drop policy if exists "Admins insert benefit events" on public.membership_benefit_events;
drop policy if exists "Admins update benefit events" on public.membership_benefit_events;
drop policy if exists "Admins delete benefit events" on public.membership_benefit_events;
drop policy if exists "Admins insert community posts" on public.community_posts;
drop policy if exists "Admins update community posts" on public.community_posts;
drop policy if exists "Admins delete community posts" on public.community_posts;
drop policy if exists "Admins insert community live events" on public.community_live_events;
drop policy if exists "Admins update community live events" on public.community_live_events;
drop policy if exists "Admins delete community live events" on public.community_live_events;

create policy "Admins insert membership tiers"
  on public.membership_tiers for insert
  to authenticated
  with check (public.has_role((select auth.uid()), 'admin'::public.app_role));

create policy "Admins update membership tiers"
  on public.membership_tiers for update
  to authenticated
  using (public.has_role((select auth.uid()), 'admin'::public.app_role))
  with check (public.has_role((select auth.uid()), 'admin'::public.app_role));

create policy "Admins delete membership tiers"
  on public.membership_tiers for delete
  to authenticated
  using (public.has_role((select auth.uid()), 'admin'::public.app_role));

create policy "Admins insert subscriptions"
  on public.membership_subscriptions for insert
  to authenticated
  with check (public.has_role((select auth.uid()), 'admin'::public.app_role));

create policy "Admins update subscriptions"
  on public.membership_subscriptions for update
  to authenticated
  using (public.has_role((select auth.uid()), 'admin'::public.app_role))
  with check (public.has_role((select auth.uid()), 'admin'::public.app_role));

create policy "Admins delete subscriptions"
  on public.membership_subscriptions for delete
  to authenticated
  using (public.has_role((select auth.uid()), 'admin'::public.app_role));

create policy "Admins insert membership payments"
  on public.membership_payments for insert
  to authenticated
  with check (public.has_role((select auth.uid()), 'admin'::public.app_role));

create policy "Admins update membership payments"
  on public.membership_payments for update
  to authenticated
  using (public.has_role((select auth.uid()), 'admin'::public.app_role))
  with check (public.has_role((select auth.uid()), 'admin'::public.app_role));

create policy "Admins delete membership payments"
  on public.membership_payments for delete
  to authenticated
  using (public.has_role((select auth.uid()), 'admin'::public.app_role));

create policy "Admins insert benefit events"
  on public.membership_benefit_events for insert
  to authenticated
  with check (public.has_role((select auth.uid()), 'admin'::public.app_role));

create policy "Admins update benefit events"
  on public.membership_benefit_events for update
  to authenticated
  using (public.has_role((select auth.uid()), 'admin'::public.app_role))
  with check (public.has_role((select auth.uid()), 'admin'::public.app_role));

create policy "Admins delete benefit events"
  on public.membership_benefit_events for delete
  to authenticated
  using (public.has_role((select auth.uid()), 'admin'::public.app_role));

create policy "Admins insert community posts"
  on public.community_posts for insert
  to authenticated
  with check (public.has_role((select auth.uid()), 'admin'::public.app_role));

create policy "Admins update community posts"
  on public.community_posts for update
  to authenticated
  using (public.has_role((select auth.uid()), 'admin'::public.app_role))
  with check (public.has_role((select auth.uid()), 'admin'::public.app_role));

create policy "Admins delete community posts"
  on public.community_posts for delete
  to authenticated
  using (public.has_role((select auth.uid()), 'admin'::public.app_role));

create policy "Admins insert community live events"
  on public.community_live_events for insert
  to authenticated
  with check (public.has_role((select auth.uid()), 'admin'::public.app_role));

create policy "Admins update community live events"
  on public.community_live_events for update
  to authenticated
  using (public.has_role((select auth.uid()), 'admin'::public.app_role))
  with check (public.has_role((select auth.uid()), 'admin'::public.app_role));

create policy "Admins delete community live events"
  on public.community_live_events for delete
  to authenticated
  using (public.has_role((select auth.uid()), 'admin'::public.app_role));
