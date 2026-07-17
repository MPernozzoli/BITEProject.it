create table if not exists public.voyage_booking_drafts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  voyage_id uuid not null references public.voyages(id) on delete cascade,
  leg_ids uuid[] not null default '{}'::uuid[],
  party_size integer not null default 1,
  message text,
  candidate_info jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint voyage_booking_drafts_party_size_positive check (party_size > 0),
  constraint voyage_booking_drafts_candidate_info_object check (jsonb_typeof(candidate_info) = 'object'),
  unique (profile_id, voyage_id)
);

create index if not exists voyage_booking_drafts_profile_updated_idx
  on public.voyage_booking_drafts(profile_id, updated_at desc);

alter table public.voyage_booking_drafts enable row level security;

grant select, insert, update, delete on public.voyage_booking_drafts to authenticated;

drop trigger if exists touch_voyage_booking_drafts_updated_at on public.voyage_booking_drafts;
create trigger touch_voyage_booking_drafts_updated_at
  before update on public.voyage_booking_drafts
  for each row execute function public.touch_updated_at();

drop policy if exists "Users manage own booking drafts" on public.voyage_booking_drafts;
create policy "Users manage own booking drafts"
  on public.voyage_booking_drafts
  for all
  to authenticated
  using ((select auth.uid()) = profile_id)
  with check ((select auth.uid()) = profile_id);

drop policy if exists "Admins read booking drafts" on public.voyage_booking_drafts;
create policy "Admins read booking drafts"
  on public.voyage_booking_drafts
  for select
  to authenticated
  using (public.has_role((select auth.uid()), 'admin'::public.app_role));
