-- Replace client-callable SECURITY DEFINER poll result RPC with maintained stats.

create table public.community_poll_option_stats (
  option_id uuid primary key references public.community_poll_options(id) on delete cascade,
  poll_id uuid not null references public.community_polls(id) on delete cascade,
  votes_count bigint not null default 0 check (votes_count >= 0),
  updated_at timestamptz not null default now()
);

create index community_poll_option_stats_poll_idx
  on public.community_poll_option_stats(poll_id);

insert into public.community_poll_option_stats (option_id, poll_id, votes_count)
select
  o.id,
  o.poll_id,
  count(v.id)::bigint
from public.community_poll_options o
left join public.community_poll_votes v on v.option_id = o.id
group by o.id, o.poll_id
on conflict (option_id) do update
set votes_count = excluded.votes_count,
    updated_at = now();

create or replace function public.sync_community_poll_option_stats()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_option_id uuid;
  affected_poll_id uuid;
begin
  if tg_table_name = 'community_poll_options' then
    affected_option_id := new.id;
    affected_poll_id := new.poll_id;
  elsif tg_op = 'DELETE' then
    affected_option_id := old.option_id;
    affected_poll_id := old.poll_id;
  else
    affected_option_id := new.option_id;
    affected_poll_id := new.poll_id;
  end if;

  if tg_table_name = 'community_poll_options' then
    insert into public.community_poll_option_stats (option_id, poll_id, votes_count)
    values (affected_option_id, affected_poll_id, 0)
    on conflict (option_id) do nothing;
    return new;
  end if;

  insert into public.community_poll_option_stats (option_id, poll_id, votes_count)
  select affected_option_id, affected_poll_id, count(v.id)::bigint
  from public.community_poll_votes v
  where v.option_id = affected_option_id
  on conflict (option_id) do update
  set votes_count = excluded.votes_count,
      updated_at = now();

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger community_poll_options_create_stats
  after insert on public.community_poll_options
  for each row execute function public.sync_community_poll_option_stats();

create trigger community_poll_votes_update_stats_insert
  after insert on public.community_poll_votes
  for each row execute function public.sync_community_poll_option_stats();

create trigger community_poll_votes_update_stats_delete
  after delete on public.community_poll_votes
  for each row execute function public.sync_community_poll_option_stats();

revoke all on function public.sync_community_poll_option_stats() from public, anon, authenticated;
revoke all on function public.get_community_poll_results(uuid) from public, anon, authenticated;
drop function public.get_community_poll_results(uuid);

alter table public.community_poll_option_stats enable row level security;

create policy "Readable community poll stats anon"
  on public.community_poll_option_stats for select
  to anon
  using (public.can_read_community_poll(poll_id, null));

create policy "Readable community poll stats authenticated"
  on public.community_poll_option_stats for select
  to authenticated
  using (
    public.can_read_community_poll(poll_id, (select auth.uid()))
    or public.has_role((select auth.uid()), 'admin'::public.app_role)
  );

grant select on public.community_poll_option_stats to anon, authenticated;

alter publication supabase_realtime add table public.community_poll_option_stats;
