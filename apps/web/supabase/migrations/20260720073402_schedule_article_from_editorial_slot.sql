-- Keep the site editorial calendar as the source of truth for article scheduling.
-- Assigning an article to a site slot schedules it at that slot; freeing the slot
-- unschedules only articles that are still waiting for that exact slot.

create or replace function public.editorial_plan_slot_scheduled_at(
  _slot_date date,
  _slot_time time,
  _timezone text
)
returns timestamptz
language sql
stable
set search_path = public
as $$
  select (_slot_date::timestamp + _slot_time) at time zone coalesce(nullif(_timezone, ''), 'Europe/Rome')
$$;

comment on function public.editorial_plan_slot_scheduled_at(date, time, text) is
  'Converts an editorial plan slot date/time in the channel timezone to the timestamptz used by logbook_articles.scheduled_at.';

create or replace function public.sync_site_article_schedule_from_editorial_slot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  channel_code text;
  channel_timezone text;
  old_channel_code text;
  old_channel_timezone text;
  next_scheduled_at timestamptz;
  old_scheduled_at timestamptz;
begin
  select code, timezone
  into channel_code, channel_timezone
  from public.editorial_plan_channels
  where id = new.channel_id;

  if tg_op = 'UPDATE' then
    select code, timezone
    into old_channel_code, old_channel_timezone
    from public.editorial_plan_channels
    where id = old.channel_id;
  end if;

  if channel_code = 'site' and new.status = 'assigned' and new.assigned_article_id is not null then
    next_scheduled_at := public.editorial_plan_slot_scheduled_at(
      new.slot_date,
      new.slot_time,
      channel_timezone
    );

    update public.logbook_articles
    set
      status = 'scheduled',
      scheduled_at = next_scheduled_at,
      published_at = null,
      updated_at = timezone('utc', now())
    where id = new.assigned_article_id
      and status <> 'published';
  end if;

  if tg_op = 'UPDATE' and old_channel_code = 'site' and old.assigned_article_id is not null and (
    old.assigned_article_id is distinct from new.assigned_article_id
    or old.status is distinct from new.status
    or old.slot_date is distinct from new.slot_date
    or old.slot_time is distinct from new.slot_time
    or old.channel_id is distinct from new.channel_id
  ) then
    old_scheduled_at := public.editorial_plan_slot_scheduled_at(
      old.slot_date,
      old.slot_time,
      old_channel_timezone
    );

    update public.logbook_articles
    set
      status = 'draft',
      scheduled_at = null,
      updated_at = timezone('utc', now())
    where id = old.assigned_article_id
      and status = 'scheduled'
      and scheduled_at = old_scheduled_at;
  end if;

  return new;
end;
$$;

revoke execute on function public.sync_site_article_schedule_from_editorial_slot() from public, anon, authenticated;
grant execute on function public.sync_site_article_schedule_from_editorial_slot() to postgres, service_role;

drop trigger if exists editorial_plan_slots_sync_site_article_schedule on public.editorial_plan_slots;
create trigger editorial_plan_slots_sync_site_article_schedule
after insert or update of assigned_article_id, status, slot_date, slot_time, channel_id
on public.editorial_plan_slots
for each row
execute function public.sync_site_article_schedule_from_editorial_slot();

-- Reconcile existing assigned site slots, including the missed 2026-07-20 slot.
update public.editorial_plan_slots
set
  status = status,
  updated_at = timezone('utc', now())
where channel_id = '11111111-1111-4111-8111-111111110001'::uuid
  and status = 'assigned'
  and assigned_article_id is not null;
