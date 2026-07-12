-- Read-side helper: the invited guest cannot read the owner's booking row (RLS), so this
-- SECURITY DEFINER function returns their own participations with the voyage context needed
-- to render the "pending invitations" section and decide whether payment is required.

create or replace function public.get_my_participations()
returns table (
  participant_id uuid,
  booking_request_id uuid,
  status text,
  is_lead boolean,
  voyage_id uuid,
  voyage_name text,
  voyage_name_it text,
  voyage_name_en text,
  party_size integer,
  payment_mode text,
  requires_payment boolean,
  deposit_paid boolean,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    p.id,
    p.booking_request_id,
    p.status,
    p.is_lead,
    r.voyage_id,
    v.name,
    v.name_it,
    v.name_en,
    r.party_size,
    r.payment_mode,
    (r.payment_mode = 'each_pays_own' and p.is_lead = false) as requires_payment,
    exists (
      select 1 from public.voyage_booking_deposits d
      where d.booking_request_id = r.id and d.participant_id = p.id and d.status = 'paid'
    ) as deposit_paid,
    p.expires_at
  from public.voyage_booking_participants p
  join public.voyage_booking_requests r on r.id = p.booking_request_id
  join public.voyages v on v.id = r.voyage_id
  where p.is_lead = false
    and (
      p.profile_id = auth.uid()
      or lower(p.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
  order by p.created_at desc;
$$;
grant execute on function public.get_my_participations() to authenticated;
