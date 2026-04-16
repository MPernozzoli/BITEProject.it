-- Editorial plan: internal admin-only classification and calendar slots.

do $$ begin
  create type public.article_editorial_type as enum ('pillar', 'support', 'utility_reflection');
exception
  when duplicate_object then null;
end $$;

alter table public.logbook_articles
  add column if not exists editorial_type public.article_editorial_type;

comment on column public.logbook_articles.editorial_type is
  'Internal editorial pillar for planning (admin-only); distinct from public category.';

-- Singleton settings row (fixed id for app convenience).
create table if not exists public.editorial_plan_settings (
  id uuid primary key default 'a0000000-0000-4000-8000-000000000001'::uuid,
  weekly_count integer not null default 1
    constraint editorial_plan_settings_weekly_count_check check (weekly_count >= 1 and weekly_count <= 21),
  mix_pillar numeric(5, 2) not null default 15,
  mix_support numeric(5, 2) not null default 55,
  mix_utility numeric(5, 2) not null default 30,
  timezone text not null default 'Europe/Rome',
  horizon_weeks integer not null default 8
    constraint editorial_plan_settings_horizon_check check (horizon_weeks >= 1 and horizon_weeks <= 52),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint editorial_plan_settings_mix_sum_check check (
    abs((mix_pillar + mix_support + mix_utility) - 100) < 0.02
  )
);

comment on table public.editorial_plan_settings is
  'Singleton editorial cadence and mix targets (admin-only).';

create table if not exists public.editorial_plan_weekly_slots (
  id uuid primary key default gen_random_uuid(),
  day_of_week smallint not null
    constraint editorial_plan_weekly_slots_dow_check check (day_of_week >= 0 and day_of_week <= 6),
  time_of_day time not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now())
);

comment on table public.editorial_plan_weekly_slots is
  'Recurring weekly publication slots (0=Sunday .. 6=Saturday, same as JS getDay).';

create table if not exists public.editorial_plan_slots (
  id uuid primary key default gen_random_uuid(),
  slot_date date not null,
  slot_time time not null,
  template_id uuid references public.editorial_plan_weekly_slots (id) on delete set null,
  suggested_type public.article_editorial_type,
  override_type public.article_editorial_type,
  assigned_article_id uuid references public.logbook_articles (id) on delete set null,
  status text not null default 'open'
    constraint editorial_plan_slots_status_check check (status in ('open', 'assigned', 'skipped')),
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint editorial_plan_slots_date_time_unique unique (slot_date, slot_time)
);

comment on table public.editorial_plan_slots is
  'Concrete editorial calendar slots; suggested_type is planning hint, override_type forces display.';

create index if not exists editorial_plan_slots_slot_date_idx on public.editorial_plan_slots (slot_date);
create index if not exists editorial_plan_slots_assigned_article_idx on public.editorial_plan_slots (assigned_article_id);

alter table public.editorial_plan_settings enable row level security;
alter table public.editorial_plan_weekly_slots enable row level security;
alter table public.editorial_plan_slots enable row level security;

grant select, insert, update, delete on public.editorial_plan_settings to authenticated;
grant select, insert, update, delete on public.editorial_plan_weekly_slots to authenticated;
grant select, insert, update, delete on public.editorial_plan_slots to authenticated;

drop policy if exists "Admins manage editorial_plan_settings" on public.editorial_plan_settings;
create policy "Admins manage editorial_plan_settings"
  on public.editorial_plan_settings
  for all
  to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

drop policy if exists "Admins manage editorial_plan_weekly_slots" on public.editorial_plan_weekly_slots;
create policy "Admins manage editorial_plan_weekly_slots"
  on public.editorial_plan_weekly_slots
  for all
  to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

drop policy if exists "Admins manage editorial_plan_slots" on public.editorial_plan_slots;
create policy "Admins manage editorial_plan_slots"
  on public.editorial_plan_slots
  for all
  to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- Seed singleton + one Monday 09:00 slot (JS Monday = 1).
insert into public.editorial_plan_settings (id, weekly_count, mix_pillar, mix_support, mix_utility, timezone, horizon_weeks)
values (
  'a0000000-0000-4000-8000-000000000001'::uuid,
  1,
  15,
  55,
  30,
  'Europe/Rome',
  8
)
on conflict (id) do nothing;

insert into public.editorial_plan_weekly_slots (day_of_week, time_of_day, sort_order)
select 1, time '09:00', 0
where not exists (select 1 from public.editorial_plan_weekly_slots limit 1);
