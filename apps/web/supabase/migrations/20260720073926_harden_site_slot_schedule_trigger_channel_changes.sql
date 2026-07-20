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
