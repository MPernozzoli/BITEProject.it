-- Bunq security-deposit ("caparra") support.
--
-- 1. bunq_api_contexts: encrypted Bunq installation/device context, one row per
--    environment (sandbox | production). Written and read only by the service role
--    (the Vercel payment functions); never exposed to clients.
-- 2. voyage_booking_deposits: one deposit payment per booking request, tracking the
--    Bunq request-inquiry, its share URL and the settlement status. The deposit is a
--    refundable commitment, not a fare.

-- --- Bunq API context (service-role only) --------------------------------------------

create table if not exists public.bunq_api_contexts (
  environment text primary key check (environment in ('sandbox', 'production')),
  encrypted_context text not null,
  updated_at timestamptz not null default timezone('utc', now())
);
alter table public.bunq_api_contexts enable row level security;
-- No policies: only the service role (which bypasses RLS) may touch this table.

-- --- Deposit payments ----------------------------------------------------------------

create table if not exists public.voyage_booking_deposits (
  id uuid primary key default gen_random_uuid(),
  booking_request_id uuid not null references public.voyage_booking_requests(id) on delete cascade,
  environment text not null check (environment in ('sandbox', 'production')),
  -- Authoritative amounts, in cents, computed server-side from the leg complexity.
  per_person_cents integer not null check (per_person_cents >= 0),
  party_size integer not null check (party_size > 0),
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'EUR',
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'refunded', 'failed', 'cancelled')),
  -- Bunq request-inquiry id and the shareable bunq.me payment link.
  bunq_request_id bigint,
  share_url text,
  -- Short human reference embedded in the Bunq description for reconciliation.
  reference text not null,
  created_at timestamptz not null default timezone('utc', now()),
  paid_at timestamptz,
  refunded_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now())
);
create index if not exists voyage_booking_deposits_request_idx
  on public.voyage_booking_deposits(booking_request_id);
create unique index if not exists voyage_booking_deposits_bunq_request_uidx
  on public.voyage_booking_deposits(environment, bunq_request_id)
  where bunq_request_id is not null;
create unique index if not exists voyage_booking_deposits_reference_uidx
  on public.voyage_booking_deposits(reference);
alter table public.voyage_booking_deposits enable row level security;
-- A user may read the deposit(s) attached to their own booking requests.
drop policy if exists "read own booking deposits" on public.voyage_booking_deposits;
create policy "read own booking deposits"
  on public.voyage_booking_deposits
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.voyage_booking_requests r
      where r.id = booking_request_id
        and r.profile_id = auth.uid()
    )
  );
-- Inserts/updates happen exclusively through the service role (Vercel functions),
-- which bypasses RLS; no write policies are granted to clients.;
