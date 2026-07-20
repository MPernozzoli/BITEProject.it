drop policy if exists "admins read booking deposits" on public.voyage_booking_deposits;
create policy "admins read booking deposits"
  on public.voyage_booking_deposits
  for select
  to authenticated
  using (public.has_role((select auth.uid()), 'admin'::public.app_role));
