-- Foundations for "contribution proposal / workaway" applications: a global, admin-managed
-- catalog of workaway roles, and per-voyage settings that gate whether a candidate is even
-- allowed to propose an alternative contribution or a workaway role for that specific voyage.
--
-- The catalog is global (roles are reused across voyages) but activation is per voyage: an
-- admin picks which of the catalog roles are actually useful for a given crossing via
-- voyage_booking_settings.workaway_role_keys. The candidate-facing autocomplete still searches
-- the whole catalog (a role can be proposed even if not "activated" for that voyage — see
-- attach_voyage_booking_contribution_proposal in a later migration), it's just flagged as
-- not currently sought after.

create table public.voyage_workaway_roles (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label_it text not null,
  label_en text not null,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

comment on table public.voyage_workaway_roles is
  'Global catalog of workaway roles (social media manager, videomaker, cook, skipper, ...). Admin-managed; activation per voyage lives on voyage_booking_settings.workaway_role_keys.';

alter table public.voyage_workaway_roles enable row level security;

create policy "Admins manage workaway roles"
  on public.voyage_workaway_roles for all
  to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role))
  with check (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Any authenticated candidate needs to read the catalog for the application-form autocomplete.
create policy "Authenticated read workaway roles"
  on public.voyage_workaway_roles for select
  to authenticated
  using (true);

grant select, insert, update, delete on public.voyage_workaway_roles to authenticated;

create index voyage_workaway_roles_active_sort_idx
  on public.voyage_workaway_roles(active, sort_order);

-- ---------------------------------------------------------------------------
-- Per-voyage settings: opt-in switches + acceptable proposal range
-- ---------------------------------------------------------------------------

alter table public.voyage_booking_settings
  add column if not exists contribution_proposal_enabled boolean not null default false,
  add column if not exists contribution_proposal_min_percent numeric(6, 2) not null default 50,
  add column if not exists contribution_proposal_max_percent numeric(6, 2) not null default 150,
  add column if not exists workaway_enabled boolean not null default false,
  add column if not exists workaway_role_keys text[] not null default '{}';

alter table public.voyage_booking_settings
  add constraint voyage_booking_settings_proposal_percent_positive
    check (contribution_proposal_min_percent > 0),
  add constraint voyage_booking_settings_proposal_percent_order
    check (contribution_proposal_max_percent >= contribution_proposal_min_percent);

comment on column public.voyage_booking_settings.contribution_proposal_enabled is
  'When true, candidates applying to this voyage may propose an alternative variable contribution instead of the calculated default.';
comment on column public.voyage_booking_settings.contribution_proposal_min_percent is
  'Lower bound, as a percentage of the calculated variable contribution, that a candidate may propose (e.g. 50 = can propose down to half).';
comment on column public.voyage_booking_settings.contribution_proposal_max_percent is
  'Upper bound, as a percentage of the calculated variable contribution, that a candidate may propose.';
comment on column public.voyage_booking_settings.workaway_enabled is
  'When true, candidates applying to this voyage may propose a workaway (in-kind) contribution instead of, or alongside, an economic one.';
comment on column public.voyage_booking_settings.workaway_role_keys is
  'Subset of voyage_workaway_roles.key activated ("sought after") for this specific voyage. A candidate may still propose a role outside this set; the UI just flags it as not currently sought.';
