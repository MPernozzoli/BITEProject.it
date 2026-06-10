create table if not exists public.external_metrics_cache (
  slug text primary key,
  source_url text not null,
  payload jsonb not null,
  fetched_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create or replace function public.set_external_metrics_cache_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists external_metrics_cache_set_updated_at on public.external_metrics_cache;

create trigger external_metrics_cache_set_updated_at
before update on public.external_metrics_cache
for each row
execute function public.set_external_metrics_cache_updated_at();
