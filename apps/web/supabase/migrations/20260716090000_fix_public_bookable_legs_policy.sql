-- Fix: anonymous visitors could not read published bookable legs.
--
-- "Published bookable legs are readable" is granted `to public`, but its USING
-- clause ends in `OR has_role(auth.uid(), 'admin')`. Since 20260712012502 revoked
-- execute on has_role from anon, evaluating the policy raised
-- "permission denied for function has_role" and the read failed outright — the
-- policy denied exactly the audience it was written for. Postgres gives no
-- short-circuit guarantee, so the leading EXISTS being true does not save it.
--
-- The has_role branch was redundant anyway: "Admins manage bookable legs" is a
-- PERMISSIVE policy FOR ALL TO authenticated on the same table, and permissive
-- policies are OR-ed, so admins already read every leg through it — including
-- legs of unpublished or booking-disabled voyages. Dropping the branch changes
-- nothing for admins and lets anon evaluate the policy without calling anything
-- it may not execute.
--
-- Nothing reads this table as anon today (the public site goes through the
-- get_public_voyage_leg_availability RPC, which is security definer), so this is
-- a latent fix, not a live outage.

drop policy if exists "Published bookable legs are readable" on public.voyage_bookable_legs;
create policy "Published bookable legs are readable"
  on public.voyage_bookable_legs
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.voyages v
      where v.id = voyage_bookable_legs.voyage_id
        and v.is_published = true
        and v.booking_enabled = true
    )
  );
