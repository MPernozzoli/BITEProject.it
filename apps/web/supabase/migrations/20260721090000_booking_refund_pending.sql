-- Refunds that cannot be routed automatically (payer is not a Bunq user and we do not
-- hold their IBAN) must no longer block the rejection/cancellation. We record the amount
-- still owed on the deposit so an admin can settle it manually once the traveller replies
-- with their IBAN.

alter table public.voyage_booking_deposits
  add column if not exists refund_pending boolean not null default false,
  add column if not exists refund_pending_amount_cents integer not null default 0
    check (refund_pending_amount_cents >= 0),
  add column if not exists refund_pending_reason text;

create index if not exists voyage_booking_deposits_refund_pending_idx
  on public.voyage_booking_deposits(refund_pending)
  where refund_pending;

comment on column public.voyage_booking_deposits.refund_pending is
  'A refund is owed but could not be paid automatically (no IBAN / payer is not a Bunq user). Settle manually once the traveller provides an IBAN.';

-- Admin listing of refunds still owed, joined with the traveller + voyage so the
-- operator knows who to expect an IBAN from and how much is due.
create or replace function public.admin_list_pending_refunds()
returns table (
  deposit_id uuid,
  booking_request_id uuid,
  voyage_id uuid,
  voyage_name text,
  voyage_name_it text,
  voyage_name_en text,
  traveller_name text,
  traveller_email text,
  amount_cents integer,
  pending_amount_cents integer,
  reason text,
  environment text,
  reference text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'Only admins can list pending refunds' using errcode = '42501';
  end if;

  return query
  select
    d.id,
    d.booking_request_id,
    req.voyage_id,
    v.name,
    v.name_it,
    v.name_en,
    p.name,
    p.email,
    d.amount_cents,
    d.refund_pending_amount_cents,
    d.refund_pending_reason,
    d.environment,
    d.reference,
    d.updated_at
  from public.voyage_booking_deposits d
  join public.voyage_booking_requests req on req.id = d.booking_request_id
  left join public.voyages v on v.id = req.voyage_id
  left join public.profiles p on p.id = req.profile_id
  where d.refund_pending
  order by d.updated_at desc;
end;
$$;

-- Mark a manual refund as settled once the operator has paid it.
create or replace function public.admin_resolve_pending_refund(_deposit_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'Only admins can resolve refunds' using errcode = '42501';
  end if;

  update public.voyage_booking_deposits
  set refund_pending = false,
      refund_pending_amount_cents = 0,
      refund_pending_reason = null,
      updated_at = now()
  where id = _deposit_id and refund_pending;
end;
$$;

revoke execute on function public.admin_list_pending_refunds() from public, anon;
grant execute on function public.admin_list_pending_refunds() to authenticated;
revoke execute on function public.admin_resolve_pending_refund(uuid) from public, anon;
grant execute on function public.admin_resolve_pending_refund(uuid) to authenticated;

-- Self-service listing: a traveller sees only the refunds owed on their own bookings, so the
-- refund form can pre-fill the (non-editable) amount we already decided.
create or replace function public.list_my_pending_refunds()
returns table (
  deposit_id uuid,
  booking_request_id uuid,
  voyage_id uuid,
  voyage_name text,
  voyage_name_it text,
  voyage_name_en text,
  amount_cents integer,
  reference text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  return query
  select
    d.id,
    d.booking_request_id,
    req.voyage_id,
    v.name,
    v.name_it,
    v.name_en,
    d.refund_pending_amount_cents,
    d.reference
  from public.voyage_booking_deposits d
  join public.voyage_booking_requests req on req.id = d.booking_request_id
  left join public.voyages v on v.id = req.voyage_id
  where d.refund_pending
    and req.profile_id = auth.uid()
  order by d.updated_at desc;
end;
$$;

revoke execute on function public.list_my_pending_refunds() from public, anon;
grant execute on function public.list_my_pending_refunds() to authenticated;
