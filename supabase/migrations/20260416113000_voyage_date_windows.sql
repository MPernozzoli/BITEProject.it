alter table public.voyages
  add column if not exists start_date_flex_days integer,
  add column if not exists end_date_flex_days integer;

update public.voyages
set
  start_date_flex_days = case
    when start_date_flex_days is null or start_date_flex_days < 0 then 0
    else start_date_flex_days
  end,
  end_date_flex_days = case
    when end_date_flex_days is null or end_date_flex_days < 0 then 0
    else end_date_flex_days
  end;

alter table public.voyages
  add constraint voyages_start_date_flex_days_nonnegative
    check (start_date_flex_days is null or start_date_flex_days >= 0),
  add constraint voyages_end_date_flex_days_nonnegative
    check (end_date_flex_days is null or end_date_flex_days >= 0);

comment on column public.voyages.start_date_flex_days is
  'Optional flex window in days for planned voyage departure date.';

comment on column public.voyages.end_date_flex_days is
  'Optional flex window in days for planned voyage arrival date.';
