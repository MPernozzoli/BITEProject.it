-- Non-commercial voyage availability updates.
--
-- Users can ask to be notified when new bookable voyages are published, or when
-- selected full legs on an existing voyage become available again. Delivery is
-- queued here and sent by the dispatch-voyage-availability-updates Edge Function.

create table if not exists public.voyage_availability_watches (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  voyage_id uuid references public.voyages(id) on delete cascade,
  leg_ids uuid[] not null default '{}'::uuid[],
  scope text not null default 'voyage_availability',
  active boolean not null default true,
  source text not null default 'booking',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  last_notified_at timestamptz,
  constraint voyage_availability_watches_scope_check
    check (scope in ('all_bookable_voyages', 'voyage_availability')),
  constraint voyage_availability_watches_scope_shape_check
    check (
      (scope = 'all_bookable_voyages' and voyage_id is null and cardinality(leg_ids) = 0)
      or
      (scope = 'voyage_availability' and voyage_id is not null)
    )
);

create unique index if not exists voyage_availability_watches_general_once_idx
  on public.voyage_availability_watches(profile_id)
  where scope = 'all_bookable_voyages';

create unique index if not exists voyage_availability_watches_voyage_once_idx
  on public.voyage_availability_watches(profile_id, voyage_id)
  where scope = 'voyage_availability';

create index if not exists voyage_availability_watches_active_general_idx
  on public.voyage_availability_watches(profile_id)
  where active = true and scope = 'all_bookable_voyages';

create index if not exists voyage_availability_watches_active_voyage_idx
  on public.voyage_availability_watches(voyage_id)
  where active = true and scope = 'voyage_availability';

drop trigger if exists touch_voyage_availability_watches_updated_at on public.voyage_availability_watches;
create trigger touch_voyage_availability_watches_updated_at
  before update on public.voyage_availability_watches
  for each row execute function public.update_updated_at_column();

create table if not exists public.voyage_availability_notifications (
  id uuid primary key default gen_random_uuid(),
  watch_id uuid not null references public.voyage_availability_watches(id) on delete cascade,
  recipient_profile_id uuid not null references public.profiles(id) on delete cascade,
  voyage_id uuid not null references public.voyages(id) on delete cascade,
  event_type text not null,
  leg_ids uuid[] not null default '{}'::uuid[],
  metadata jsonb not null default '{}'::jsonb,
  queued_at timestamptz not null default timezone('utc', now()),
  processed_at timestamptz,
  emailed_at timestamptz,
  failed_at timestamptz,
  error_message text,
  constraint voyage_availability_notifications_event_type_check
    check (event_type in ('new_bookable_voyage', 'availability_opened'))
);

create unique index if not exists voyage_availability_notifications_once_idx
  on public.voyage_availability_notifications(watch_id, voyage_id, event_type, leg_ids)
  where failed_at is null;

create index if not exists voyage_availability_notifications_pending_idx
  on public.voyage_availability_notifications(queued_at)
  where processed_at is null and failed_at is null;

alter table public.voyage_availability_watches enable row level security;
alter table public.voyage_availability_notifications enable row level security;

grant select on public.voyage_availability_watches to authenticated;
grant select on public.voyage_availability_notifications to authenticated;
grant insert, update on public.voyage_availability_watches to authenticated, service_role;
grant insert, update on public.voyage_availability_notifications to service_role;

drop policy if exists "Users manage own voyage availability watches" on public.voyage_availability_watches;
create policy "Users manage own voyage availability watches"
  on public.voyage_availability_watches
  for all
  to authenticated
  using (profile_id = (select auth.uid()) or public.has_role((select auth.uid()), 'admin'::public.app_role))
  with check (profile_id = (select auth.uid()) or public.has_role((select auth.uid()), 'admin'::public.app_role));

drop policy if exists "Users read own voyage availability notifications" on public.voyage_availability_notifications;
create policy "Users read own voyage availability notifications"
  on public.voyage_availability_notifications
  for select
  to authenticated
  using (
    recipient_profile_id = (select auth.uid())
    or public.has_role((select auth.uid()), 'admin'::public.app_role)
  );

create or replace function public.booking_leg_remaining_capacity(_leg_id uuid)
returns integer
language sql
stable
set search_path = public, pg_temp
as $$
  with leg_row as (
    select leg.id, leg.voyage_id
    from public.voyage_bookable_legs leg
    where leg.id = _leg_id
      and leg.is_bookable = true
      and public.booking_leg_is_current_or_future(
        leg.starts_at_window_start,
        leg.starts_at_window_end,
        leg.ends_at_window_start,
        leg.ends_at_window_end
      )
  ),
  occupied as (
    select coalesce(sum(req.party_size), 0)::integer as value
    from public.voyage_booking_request_legs link
    join public.voyage_booking_requests req on req.id = link.booking_request_id
    where link.bookable_leg_id = _leg_id
      and req.status in ('admin_approved', 'user_confirmed')
      and (req.expires_at is null or req.expires_at > timezone('utc', now()))
  )
  select greatest(0, coalesce(v.booking_max_guests, 0) - coalesce(occupied.value, 0))
  from leg_row
  join public.voyages v on v.id = leg_row.voyage_id
  cross join occupied;
$$;

create or replace function public.list_my_voyage_availability_watches()
returns table (
  id uuid,
  profile_id uuid,
  voyage_id uuid,
  leg_ids uuid[],
  scope text,
  active boolean,
  source text,
  created_at timestamptz,
  updated_at timestamptz,
  last_notified_at timestamptz
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    watch.id,
    watch.profile_id,
    watch.voyage_id,
    watch.leg_ids,
    watch.scope,
    watch.active,
    watch.source,
    watch.created_at,
    watch.updated_at,
    watch.last_notified_at
  from public.voyage_availability_watches watch
  where watch.profile_id = (select auth.uid())
  order by watch.created_at desc;
$$;

create or replace function public.set_voyage_availability_watch(
  _scope text,
  _active boolean,
  _voyage_id uuid default null,
  _leg_ids uuid[] default '{}'::uuid[],
  _source text default 'booking'
)
returns public.voyage_availability_watches
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile_id uuid := auth.uid();
  v_scope text := coalesce(nullif(trim(_scope), ''), 'voyage_availability');
  v_leg_ids uuid[] := coalesce(_leg_ids, '{}'::uuid[]);
  v_watch public.voyage_availability_watches%rowtype;
  v_valid_leg_count integer;
begin
  if v_profile_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;

  if v_scope not in ('all_bookable_voyages', 'voyage_availability') then
    raise exception 'invalid_watch_scope' using errcode = '22023';
  end if;

  if v_scope = 'all_bookable_voyages' then
    _voyage_id := null;
    v_leg_ids := '{}'::uuid[];
  else
    if _voyage_id is null then
      raise exception 'voyage_required' using errcode = '22023';
    end if;

    if cardinality(v_leg_ids) > 0 then
      select count(*)
      into v_valid_leg_count
      from public.voyage_bookable_legs leg
      where leg.voyage_id = _voyage_id
        and leg.id = any(v_leg_ids);

      if v_valid_leg_count <> cardinality(v_leg_ids) then
        raise exception 'invalid_watch_legs' using errcode = '22023';
      end if;
    end if;
  end if;

  if v_scope = 'all_bookable_voyages' then
    insert into public.voyage_availability_watches (
      profile_id,
      voyage_id,
      leg_ids,
      scope,
      active,
      source
    )
    values (
      v_profile_id,
      null,
      '{}'::uuid[],
      v_scope,
      _active,
      coalesce(nullif(trim(_source), ''), 'booking')
    )
    on conflict (profile_id) where scope = 'all_bookable_voyages'
    do update set
      active = excluded.active,
      source = excluded.source,
      updated_at = timezone('utc', now())
    returning * into v_watch;
  else
    insert into public.voyage_availability_watches (
      profile_id,
      voyage_id,
      leg_ids,
      scope,
      active,
      source
    )
    values (
      v_profile_id,
      _voyage_id,
      v_leg_ids,
      v_scope,
      _active,
      coalesce(nullif(trim(_source), ''), 'booking')
    )
    on conflict (profile_id, voyage_id) where scope = 'voyage_availability'
    do update set
      leg_ids = excluded.leg_ids,
      active = excluded.active,
      source = excluded.source,
      updated_at = timezone('utc', now())
    returning * into v_watch;
  end if;

  return v_watch;
end;
$$;

create or replace function public.enqueue_voyage_availability_notifications(
  _event_type text,
  _voyage_id uuid,
  _leg_ids uuid[] default '{}'::uuid[],
  _metadata jsonb default '{}'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer := 0;
  v_leg_ids uuid[] := coalesce(_leg_ids, '{}'::uuid[]);
  watch record;
begin
  if _event_type not in ('new_bookable_voyage', 'availability_opened') then
    raise exception 'invalid_availability_event_type' using errcode = '22023';
  end if;

  for watch in
    select *
    from public.voyage_availability_watches
    where active = true
      and (
        (_event_type = 'new_bookable_voyage' and scope = 'all_bookable_voyages')
        or (
          _event_type = 'availability_opened'
          and scope = 'voyage_availability'
          and voyage_id = _voyage_id
          and (
            cardinality(leg_ids) = 0
            or cardinality(v_leg_ids) = 0
            or leg_ids && v_leg_ids
          )
        )
      )
  loop
    insert into public.voyage_availability_notifications (
      watch_id,
      recipient_profile_id,
      voyage_id,
      event_type,
      leg_ids,
      metadata
    )
    values (
      watch.id,
      watch.profile_id,
      _voyage_id,
      _event_type,
      case
        when _event_type = 'availability_opened' and cardinality(watch.leg_ids) > 0
          then watch.leg_ids
        else v_leg_ids
      end,
      coalesce(_metadata, '{}'::jsonb)
    )
    on conflict (watch_id, voyage_id, event_type, leg_ids) where failed_at is null
    do nothing;

    if found then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

create or replace function public.enqueue_new_bookable_voyage_updates()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  was_bookable boolean;
  is_bookable_now boolean;
begin
  if tg_op = 'UPDATE' then
    was_bookable := coalesce(old.booking_enabled, false) = true
      and coalesce(old.is_published, false) = true;
  else
    was_bookable := false;
  end if;

  is_bookable_now := coalesce(new.booking_enabled, false) = true
    and coalesce(new.is_published, false) = true
    and new.status in ('planned', 'active');

  if is_bookable_now and not was_bookable then
    perform public.enqueue_voyage_availability_notifications(
      'new_bookable_voyage',
      new.id,
      '{}'::uuid[],
      jsonb_build_object('trigger', 'voyage_published')
    );
  end if;

  return new;
end;
$$;

drop trigger if exists enqueue_new_bookable_voyage_updates_after_change on public.voyages;
create trigger enqueue_new_bookable_voyage_updates_after_change
  after insert or update of booking_enabled, is_published, status on public.voyages
  for each row execute function public.enqueue_new_bookable_voyage_updates();

create or replace function public.enqueue_reopened_voyage_leg_updates()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  blocking_statuses constant text[] := array['admin_approved', 'user_confirmed'];
  changed_leg_ids uuid[];
  reopened_leg_ids uuid[];
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if old.status::text = any(blocking_statuses)
    and not (new.status::text = any(blocking_statuses))
  then
    select array_agg(link.bookable_leg_id order by leg.sort_order)
    into changed_leg_ids
    from public.voyage_booking_request_legs link
    join public.voyage_bookable_legs leg on leg.id = link.bookable_leg_id
    where link.booking_request_id = new.id;

    select array_agg(leg_id)
    into reopened_leg_ids
    from unnest(coalesce(changed_leg_ids, '{}'::uuid[])) as changed(leg_id)
    where public.booking_leg_remaining_capacity(changed.leg_id) > 0;

    if cardinality(coalesce(reopened_leg_ids, '{}'::uuid[])) > 0 then
      perform public.enqueue_voyage_availability_notifications(
        'availability_opened',
        new.voyage_id,
        reopened_leg_ids,
        jsonb_build_object('trigger', 'booking_released')
      );
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists enqueue_reopened_voyage_leg_updates_after_status on public.voyage_booking_requests;
create trigger enqueue_reopened_voyage_leg_updates_after_status
  after update of status on public.voyage_booking_requests
  for each row execute function public.enqueue_reopened_voyage_leg_updates();

revoke execute on function public.booking_leg_remaining_capacity(uuid) from public, anon, authenticated;
grant execute on function public.booking_leg_remaining_capacity(uuid) to service_role;
grant execute on function public.list_my_voyage_availability_watches() to authenticated;
revoke execute on function public.set_voyage_availability_watch(text, boolean, uuid, uuid[], text) from public, anon;
grant execute on function public.set_voyage_availability_watch(text, boolean, uuid, uuid[], text) to authenticated;
revoke execute on function public.enqueue_voyage_availability_notifications(text, uuid, uuid[], jsonb) from public, anon, authenticated;
grant execute on function public.enqueue_voyage_availability_notifications(text, uuid, uuid[], jsonb) to service_role;
revoke execute on function public.enqueue_new_bookable_voyage_updates() from public, anon, authenticated;
revoke execute on function public.enqueue_reopened_voyage_leg_updates() from public, anon, authenticated;
