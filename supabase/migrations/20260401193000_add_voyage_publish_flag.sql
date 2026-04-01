alter table public.voyages
add column if not exists is_published boolean not null default true;

update public.voyages
set is_published = true
where is_published is distinct from true;
