-- Normalize schema pieces that lived in duplicate-timestamp migration files.
-- The remote history already contains the canonical migrations for these versions, so keep this
-- new migration idempotent and only add verified missing constraints/comments.

update public.voyages
set
  start_date_flex_days = case
    when start_date_flex_days is null then null
    when start_date_flex_days < 0 then 0
    else start_date_flex_days
  end,
  end_date_flex_days = case
    when end_date_flex_days is null then null
    when end_date_flex_days < 0 then 0
    else end_date_flex_days
  end;
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'voyages_start_date_flex_days_nonnegative'
      and conrelid = 'public.voyages'::regclass
  ) then
    alter table public.voyages
      add constraint voyages_start_date_flex_days_nonnegative
      check (start_date_flex_days is null or start_date_flex_days >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'voyages_end_date_flex_days_nonnegative'
      and conrelid = 'public.voyages'::regclass
  ) then
    alter table public.voyages
      add constraint voyages_end_date_flex_days_nonnegative
      check (end_date_flex_days is null or end_date_flex_days >= 0);
  end if;
end $$;
comment on column public.voyages.start_date_flex_days is
  'Optional flex window in days for planned voyage departure date.';
comment on column public.voyages.end_date_flex_days is
  'Optional flex window in days for planned voyage arrival date.';
