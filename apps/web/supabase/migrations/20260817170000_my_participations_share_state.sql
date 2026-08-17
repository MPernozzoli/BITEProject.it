-- get_my_participations feeds the guest's own view of an invitation, and it had no way to say
-- what the guest now most needs to know: whether their payment is suspended because the booker
-- is still negotiating the amount, and — once it is agreed — how much and by when.
--
-- Without this the guest sees either a pay button that the server refuses (guest_payment_suspended)
-- or, after the two-day window is armed, nothing at all: accepted participations were not
-- rendered anywhere.
--
-- Columns are appended, so existing callers keep working; the return type is replaced wholesale
-- because Postgres cannot widen a table-returning function in place.

drop function if exists public.get_my_participations();

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
  expires_at timestamptz,
  -- New: where this guest's own share stands.
  negotiation_open boolean,
  share_due_cents integer,
  share_paid_cents integer,
  share_payment_due_at timestamptz
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
    p.expires_at,
    public.voyage_booking_negotiation_open(r.id) as negotiation_open,
    case
      when r.payment_mode = 'each_pays_own' and p.is_lead = false
        -- 2000 = CONTRIBUTION_FIXED_MINIMUM_EUR in cents. The agreed variable is per person, so
        -- this is one guest's whole obligation. The payment endpoint stays authoritative.
        then (2000 + coalesce(r.contribution_resolved_variable_cents, 0))
      else null
    end as share_due_cents,
    coalesce((
      select sum(d.amount_cents)::integer
      from public.voyage_booking_deposits d
      where d.booking_request_id = r.id and d.participant_id = p.id and d.status = 'paid'
    ), 0) as share_paid_cents,
    p.share_payment_due_at
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

revoke execute on function public.get_my_participations() from public, anon;
grant execute on function public.get_my_participations() to authenticated;
