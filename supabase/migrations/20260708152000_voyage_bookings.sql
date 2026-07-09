create type public.voyage_booking_status as enum (
  'requested',
  'waitlisted',
  'admin_approved',
  'user_confirmed',
  'cancelled',
  'rejected',
  'expired'
);

alter table public.voyages
  add column if not exists booking_enabled boolean not null default false,
  add column if not exists booking_max_guests integer not null default 2,
  add column if not exists booking_planning_speed_kn numeric(6, 2) not null default 5,
  add column if not exists departure_window_start timestamptz,
  add column if not exists departure_window_end timestamptz,
  add constraint voyages_booking_max_guests_positive
    check (booking_max_guests > 0),
  add constraint voyages_booking_planning_speed_positive
    check (booking_planning_speed_kn > 0),
  add constraint voyages_departure_window_order
    check (
      departure_window_start is null
      or departure_window_end is null
      or departure_window_start <= departure_window_end
    );

alter table public.voyage_waypoints
  add column if not exists planned_stop_duration_minutes integer not null default 0,
  add constraint voyage_waypoints_stop_duration_nonnegative
    check (planned_stop_duration_minutes >= 0);

create table if not exists public.voyage_bookable_legs (
  id uuid primary key default gen_random_uuid(),
  voyage_id uuid not null references public.voyages(id) on delete cascade,
  from_waypoint_id uuid not null references public.voyage_waypoints(id) on delete cascade,
  to_waypoint_id uuid not null references public.voyage_waypoints(id) on delete cascade,
  sort_order integer not null default 0,
  starts_at_window_start timestamptz,
  starts_at_window_end timestamptz,
  ends_at_window_start timestamptz,
  ends_at_window_end timestamptz,
  is_bookable boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint voyage_bookable_legs_distinct_waypoints check (from_waypoint_id <> to_waypoint_id),
  unique (voyage_id, from_waypoint_id, to_waypoint_id)
);

create table if not exists public.voyage_booking_settings (
  voyage_id uuid primary key references public.voyages(id) on delete cascade,
  confirmation_deadline_hours integer not null default 72,
  predeparture_info_it text,
  predeparture_info_en text,
  briefing_content_it text,
  briefing_content_en text,
  terms_content_it text,
  terms_content_en text,
  required_profile_fields jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint voyage_booking_settings_deadline_positive check (confirmation_deadline_hours > 0)
);

create table if not exists public.voyage_booking_requests (
  id uuid primary key default gen_random_uuid(),
  voyage_id uuid not null references public.voyages(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  party_size integer not null default 1,
  status public.voyage_booking_status not null default 'requested',
  message text,
  admin_notes text,
  requested_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now()),
  constraint voyage_booking_requests_party_size_positive check (party_size > 0)
);

create table if not exists public.voyage_booking_request_legs (
  booking_request_id uuid not null references public.voyage_booking_requests(id) on delete cascade,
  bookable_leg_id uuid not null references public.voyage_bookable_legs(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (booking_request_id, bookable_leg_id)
);

create table if not exists public.voyage_booking_tasks (
  id uuid primary key default gen_random_uuid(),
  voyage_id uuid not null references public.voyages(id) on delete cascade,
  title_it text not null,
  title_en text,
  description_it text,
  description_en text,
  required boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.voyage_booking_task_completions (
  booking_request_id uuid not null references public.voyage_booking_requests(id) on delete cascade,
  task_id uuid not null references public.voyage_booking_tasks(id) on delete cascade,
  completed_at timestamptz not null default timezone('utc', now()),
  primary key (booking_request_id, task_id)
);

create index if not exists voyage_bookable_legs_voyage_sort_idx
  on public.voyage_bookable_legs(voyage_id, sort_order);

create index if not exists voyage_booking_requests_voyage_status_idx
  on public.voyage_booking_requests(voyage_id, status);

create index if not exists voyage_booking_requests_profile_idx
  on public.voyage_booking_requests(profile_id, requested_at desc);

create index if not exists voyage_booking_request_legs_leg_idx
  on public.voyage_booking_request_legs(bookable_leg_id);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
security invoker
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists touch_voyage_bookable_legs_updated_at on public.voyage_bookable_legs;
create trigger touch_voyage_bookable_legs_updated_at
  before update on public.voyage_bookable_legs
  for each row execute function public.touch_updated_at();

drop trigger if exists touch_voyage_booking_settings_updated_at on public.voyage_booking_settings;
create trigger touch_voyage_booking_settings_updated_at
  before update on public.voyage_booking_settings
  for each row execute function public.touch_updated_at();

drop trigger if exists touch_voyage_booking_requests_updated_at on public.voyage_booking_requests;
create trigger touch_voyage_booking_requests_updated_at
  before update on public.voyage_booking_requests
  for each row execute function public.touch_updated_at();

drop trigger if exists touch_voyage_booking_tasks_updated_at on public.voyage_booking_tasks;
create trigger touch_voyage_booking_tasks_updated_at
  before update on public.voyage_booking_tasks
  for each row execute function public.touch_updated_at();

create or replace function public.sync_voyage_bookable_legs(_voyage_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_count integer := 0;
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'Only admins can sync voyage booking legs' using errcode = '42501';
  end if;

  with ordered_public_waypoints as (
    select
      w.*,
      row_number() over (order by w.sort_order, w.created_at, w.id) as public_rank
    from public.voyage_waypoints w
    where w.voyage_id = _voyage_id
      and (
        w.visibility_mode = 'narrative'
        or (
          w.visibility_mode = 'auto'
          and (
            w.sort_order = (
              select min(w2.sort_order)
              from public.voyage_waypoints w2
              where w2.voyage_id = _voyage_id
            )
            or w.sort_order = (
              select max(w3.sort_order)
              from public.voyage_waypoints w3
              where w3.voyage_id = _voyage_id
            )
          )
        )
      )
  ),
  paired as (
    select
      current_wp.voyage_id,
      current_wp.id as from_waypoint_id,
      next_wp.id as to_waypoint_id,
      current_wp.public_rank::integer - 1 as sort_order,
      current_wp.date_start::timestamptz as starts_at_window_start,
      current_wp.date_start::timestamptz as starts_at_window_end,
      next_wp.date_end::timestamptz as ends_at_window_start,
      next_wp.date_end::timestamptz as ends_at_window_end
    from ordered_public_waypoints current_wp
    join ordered_public_waypoints next_wp
      on next_wp.public_rank = current_wp.public_rank + 1
  ),
  upserted as (
    insert into public.voyage_bookable_legs (
      voyage_id,
      from_waypoint_id,
      to_waypoint_id,
      sort_order,
      starts_at_window_start,
      starts_at_window_end,
      ends_at_window_start,
      ends_at_window_end,
      is_bookable
    )
    select
      voyage_id,
      from_waypoint_id,
      to_waypoint_id,
      sort_order,
      starts_at_window_start,
      starts_at_window_end,
      ends_at_window_start,
      ends_at_window_end,
      true
    from paired
    on conflict (voyage_id, from_waypoint_id, to_waypoint_id)
    do update set
      sort_order = excluded.sort_order,
      starts_at_window_start = excluded.starts_at_window_start,
      starts_at_window_end = excluded.starts_at_window_end,
      ends_at_window_start = excluded.ends_at_window_start,
      ends_at_window_end = excluded.ends_at_window_end,
      updated_at = timezone('utc', now())
    returning 1
  )
  select count(*) into affected_count from upserted;

  return affected_count;
end;
$$;

create or replace function public.request_voyage_booking(
  _voyage_id uuid,
  _leg_ids uuid[],
  _party_size integer default 1,
  _message text default null
)
returns table (booking_request_id uuid, booking_status public.voyage_booking_status)
language plpgsql
security definer
set search_path = public
as $$
declare
  requester uuid := auth.uid();
  capacity integer;
  selected_leg_count integer;
  full_leg_count integer;
  next_status public.voyage_booking_status;
  new_request_id uuid;
begin
  if requester is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if coalesce(_party_size, 0) <= 0 then
    raise exception 'party_size must be positive' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(_voyage_id::text, 0));

  select booking_max_guests
  into capacity
  from public.voyages
  where id = _voyage_id
    and booking_enabled = true
    and is_published = true;

  if capacity is null then
    raise exception 'Voyage is not bookable' using errcode = '22023';
  end if;

  select count(*)
  into selected_leg_count
  from public.voyage_bookable_legs leg
  where leg.voyage_id = _voyage_id
    and leg.is_bookable = true
    and leg.id = any(_leg_ids);

  if selected_leg_count = 0 or selected_leg_count <> cardinality(_leg_ids) then
    raise exception 'Invalid booking legs' using errcode = '22023';
  end if;

  with occupied as (
    select
      link.bookable_leg_id,
      coalesce(sum(req.party_size), 0) as occupied_count
    from public.voyage_booking_request_legs link
    join public.voyage_booking_requests req
      on req.id = link.booking_request_id
    where link.bookable_leg_id = any(_leg_ids)
      and req.status in ('requested', 'admin_approved', 'user_confirmed')
      and (req.expires_at is null or req.expires_at > timezone('utc', now()))
    group by link.bookable_leg_id
  )
  select count(*)
  into full_leg_count
  from unnest(_leg_ids) as requested_leg(id)
  left join occupied on occupied.bookable_leg_id = requested_leg.id
  where coalesce(occupied.occupied_count, 0) + _party_size > capacity;

  next_status := case when full_leg_count > 0 then 'waitlisted' else 'requested' end;

  insert into public.voyage_booking_requests (
    voyage_id,
    profile_id,
    party_size,
    status,
    message
  )
  values (
    _voyage_id,
    requester,
    _party_size,
    next_status,
    nullif(trim(coalesce(_message, '')), '')
  )
  returning id into new_request_id;

  insert into public.voyage_booking_request_legs (booking_request_id, bookable_leg_id)
  select new_request_id, id
  from unnest(_leg_ids) as selected_leg(id);

  booking_request_id := new_request_id;
  booking_status := next_status;
  return next;
end;
$$;

create or replace function public.confirm_voyage_booking(_booking_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.voyage_booking_requests
  set
    status = 'user_confirmed',
    confirmed_at = timezone('utc', now())
  where id = _booking_request_id
    and profile_id = auth.uid()
    and status = 'admin_approved';

  if not found then
    raise exception 'Booking cannot be confirmed' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.cancel_voyage_booking(_booking_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.voyage_booking_requests
  set
    status = 'cancelled',
    cancelled_at = timezone('utc', now())
  where id = _booking_request_id
    and profile_id = auth.uid()
    and status in ('requested', 'waitlisted', 'admin_approved', 'user_confirmed');

  if not found then
    raise exception 'Booking cannot be cancelled' using errcode = '42501';
  end if;
end;
$$;

alter table public.voyage_bookable_legs enable row level security;
alter table public.voyage_booking_settings enable row level security;
alter table public.voyage_booking_requests enable row level security;
alter table public.voyage_booking_request_legs enable row level security;
alter table public.voyage_booking_tasks enable row level security;
alter table public.voyage_booking_task_completions enable row level security;

grant select on public.voyage_bookable_legs to anon, authenticated;
grant select on public.voyage_booking_settings to authenticated;
grant select, update on public.voyage_booking_requests to authenticated;
grant select on public.voyage_booking_request_legs to authenticated;
grant select on public.voyage_booking_tasks to authenticated;
grant select, insert, delete on public.voyage_booking_task_completions to authenticated;

grant execute on function public.sync_voyage_bookable_legs(uuid) to authenticated;
grant execute on function public.request_voyage_booking(uuid, uuid[], integer, text) to authenticated;
grant execute on function public.confirm_voyage_booking(uuid) to authenticated;
grant execute on function public.cancel_voyage_booking(uuid) to authenticated;

create policy "Published bookable legs are readable"
  on public.voyage_bookable_legs
  for select
  using (
    exists (
      select 1
      from public.voyages v
      where v.id = voyage_bookable_legs.voyage_id
        and v.is_published = true
    )
  );

create policy "Admins manage bookable legs"
  on public.voyage_bookable_legs
  for all
  to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role))
  with check (public.has_role(auth.uid(), 'admin'::public.app_role));

create policy "Admins manage booking settings"
  on public.voyage_booking_settings
  for all
  to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role))
  with check (public.has_role(auth.uid(), 'admin'::public.app_role));

create policy "Voyage booking settings are readable by users"
  on public.voyage_booking_settings
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.voyages v
      where v.id = voyage_booking_settings.voyage_id
        and v.is_published = true
        and v.booking_enabled = true
    )
  );

create policy "Users read own booking requests"
  on public.voyage_booking_requests
  for select
  to authenticated
  using (
    profile_id = auth.uid()
    or public.has_role(auth.uid(), 'admin'::public.app_role)
  );

create policy "Admins manage booking requests"
  on public.voyage_booking_requests
  for all
  to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role))
  with check (public.has_role(auth.uid(), 'admin'::public.app_role));

create policy "Users read own booking request legs"
  on public.voyage_booking_request_legs
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.voyage_booking_requests r
      where r.id = voyage_booking_request_legs.booking_request_id
        and (
          r.profile_id = auth.uid()
          or public.has_role(auth.uid(), 'admin'::public.app_role)
        )
    )
  );

create policy "Admins manage booking request legs"
  on public.voyage_booking_request_legs
  for all
  to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role))
  with check (public.has_role(auth.uid(), 'admin'::public.app_role));

create policy "Booking tasks are readable for bookable voyages"
  on public.voyage_booking_tasks
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.voyages v
      where v.id = voyage_booking_tasks.voyage_id
        and v.is_published = true
        and v.booking_enabled = true
    )
    or public.has_role(auth.uid(), 'admin'::public.app_role)
  );

create policy "Admins manage booking tasks"
  on public.voyage_booking_tasks
  for all
  to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role))
  with check (public.has_role(auth.uid(), 'admin'::public.app_role));

create policy "Users manage own task completions"
  on public.voyage_booking_task_completions
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.voyage_booking_requests r
      where r.id = voyage_booking_task_completions.booking_request_id
        and r.profile_id = auth.uid()
    )
    or public.has_role(auth.uid(), 'admin'::public.app_role)
  )
  with check (
    exists (
      select 1
      from public.voyage_booking_requests r
      where r.id = voyage_booking_task_completions.booking_request_id
        and r.profile_id = auth.uid()
    )
    or public.has_role(auth.uid(), 'admin'::public.app_role)
  );
