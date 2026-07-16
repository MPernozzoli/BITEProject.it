-- Tracking for the "spritz" easter egg (the S/Y Spritz sail game in
-- src/lib/spritz-sail-game.ts, triggered by typing "spritz" on the site).
--
-- One row per discoverer: logged-in travellers are keyed by profile, anonymous
-- visitors by their browser visitor key. discovered_at always holds the first
-- opening; replays only bump last_played_at / play_count.

create table if not exists public.spritz_easter_egg_discoveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete cascade,
  visitor_key text,
  discovered_at timestamptz not null default timezone('utc', now()),
  last_played_at timestamptz not null default timezone('utc', now()),
  play_count integer not null default 1,
  constraint spritz_easter_egg_discoveries_identity_check check (
    user_id is not null or visitor_key is not null
  )
);

comment on table public.spritz_easter_egg_discoveries is
  'Who found the S/Y Spritz easter egg and when they first opened it.';
comment on column public.spritz_easter_egg_discoveries.visitor_key is
  'Browser-local key from src/lib/visitor-key.ts; the only identity available for anonymous discoverers.';
comment on column public.spritz_easter_egg_discoveries.discovered_at is
  'First opening. Never moves forward, even when an anonymous discovery is later claimed by an account.';

create unique index if not exists spritz_easter_egg_discoveries_user_idx
  on public.spritz_easter_egg_discoveries (user_id)
  where user_id is not null;

create unique index if not exists spritz_easter_egg_discoveries_visitor_idx
  on public.spritz_easter_egg_discoveries (visitor_key)
  where user_id is null and visitor_key is not null;

create index if not exists spritz_easter_egg_discoveries_discovered_at_idx
  on public.spritz_easter_egg_discoveries (discovered_at desc);

alter table public.spritz_easter_egg_discoveries enable row level security;

-- Writes only ever happen through record_spritz_discovery().
revoke all on public.spritz_easter_egg_discoveries from anon, authenticated;
grant select on public.spritz_easter_egg_discoveries to authenticated;

drop policy if exists "Admins read spritz easter egg discoveries" on public.spritz_easter_egg_discoveries;
create policy "Admins read spritz easter egg discoveries"
  on public.spritz_easter_egg_discoveries
  for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));

create or replace function public.record_spritz_discovery(_visitor_key text default null)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_visitor_key text := nullif(left(btrim(coalesce(_visitor_key, '')), 64), '');
  v_now timestamptz := timezone('utc', now());
  v_prior_discovered_at timestamptz;
  v_prior_plays integer;
  v_discovered_at timestamptz;
begin
  if v_user_id is null and v_visitor_key is null then
    return null;
  end if;

  if v_user_id is null then
    insert into public.spritz_easter_egg_discoveries as d (visitor_key, discovered_at, last_played_at)
    values (v_visitor_key, v_now, v_now)
    on conflict (visitor_key) where user_id is null and visitor_key is not null
    do update set
      last_played_at = v_now,
      play_count = d.play_count + 1
    returning d.discovered_at into v_discovered_at;

    return v_discovered_at;
  end if;

  -- This browser played anonymously before signing in: fold that row into the
  -- account so the original first-open timestamp survives the login.
  if v_visitor_key is not null then
    delete from public.spritz_easter_egg_discoveries
    where user_id is null
      and visitor_key = v_visitor_key
    returning discovered_at, play_count into v_prior_discovered_at, v_prior_plays;
  end if;

  insert into public.spritz_easter_egg_discoveries as d (
    user_id,
    visitor_key,
    discovered_at,
    last_played_at,
    play_count
  )
  values (
    v_user_id,
    v_visitor_key,
    coalesce(v_prior_discovered_at, v_now),
    v_now,
    coalesce(v_prior_plays, 0) + 1
  )
  on conflict (user_id) where user_id is not null
  do update set
    discovered_at = least(d.discovered_at, excluded.discovered_at),
    last_played_at = v_now,
    play_count = d.play_count + coalesce(v_prior_plays, 0) + 1,
    visitor_key = coalesce(excluded.visitor_key, d.visitor_key)
  returning d.discovered_at into v_discovered_at;

  return v_discovered_at;
end;
$$;

revoke all on function public.record_spritz_discovery(text) from public;
grant execute on function public.record_spritz_discovery(text) to anon, authenticated;;
