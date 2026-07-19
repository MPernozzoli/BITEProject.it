-- Engagement surfaces for BITE Crew: live threads and member polls.
-- Keeps community interaction isolated from the main app and booking flows.

create type public.community_message_status as enum (
  'visible',
  'hidden',
  'deleted'
);

create table public.community_live_messages (
  id uuid primary key default gen_random_uuid(),
  live_event_id uuid not null references public.community_live_events(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  content text not null check (char_length(trim(content)) between 1 and 2000),
  status public.community_message_status not null default 'visible',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index community_live_messages_event_idx
  on public.community_live_messages(live_event_id, created_at);

create table public.community_polls (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references public.community_posts(id) on delete set null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  question text not null check (char_length(trim(question)) between 3 and 240),
  description text not null default '',
  visibility public.community_post_visibility not null default 'members',
  min_tier_id uuid references public.membership_tiers(id) on delete set null,
  allow_multiple boolean not null default false,
  closes_at timestamptz,
  is_published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint community_polls_tier_visibility_has_tier
    check (visibility <> 'tier' or min_tier_id is not null)
);

create index community_polls_created_idx on public.community_polls(created_at desc);
create index community_polls_post_idx on public.community_polls(post_id);

create table public.community_poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.community_polls(id) on delete cascade,
  label text not null check (char_length(trim(label)) between 1 and 180),
  option_order integer not null default 0,
  created_at timestamptz not null default now()
);

create unique index community_poll_options_poll_id_id_key
  on public.community_poll_options(poll_id, id);

create index community_poll_options_poll_idx
  on public.community_poll_options(poll_id, option_order, created_at);

create table public.community_poll_votes (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.community_polls(id) on delete cascade,
  option_id uuid not null references public.community_poll_options(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint community_poll_votes_option_matches_poll
    foreign key (poll_id, option_id)
    references public.community_poll_options(poll_id, id)
    on delete cascade
);

create unique index community_poll_votes_one_per_option
  on public.community_poll_votes(option_id, profile_id);

create trigger community_live_messages_touch_updated_at
  before update on public.community_live_messages
  for each row execute function public.touch_updated_at();

create trigger community_polls_touch_updated_at
  before update on public.community_polls
  for each row execute function public.touch_updated_at();

create or replace function public.enforce_single_choice_poll_vote()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  multiple_allowed boolean;
begin
  select allow_multiple into multiple_allowed
  from public.community_polls
  where id = new.poll_id;

  if multiple_allowed is false and exists (
    select 1
    from public.community_poll_votes v
    where v.poll_id = new.poll_id
      and v.profile_id = new.profile_id
      and v.option_id <> new.option_id
  ) then
    raise exception 'Poll allows a single option' using errcode = '23505';
  end if;

  return new;
end;
$$;

create trigger community_poll_votes_enforce_single_choice
  before insert on public.community_poll_votes
  for each row execute function public.enforce_single_choice_poll_vote();

create or replace function public.can_read_community_live_event(_event_id uuid, _profile_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1
    from public.community_live_events e
    left join public.membership_tiers min_tier on min_tier.id = e.min_tier_id
    where e.id = _event_id
      and (
        e.visibility = 'public'
        or (
          _profile_id is not null
          and public.active_membership_tier_order(_profile_id) is not null
          and (
            e.visibility = 'members'
            or (
              e.visibility = 'tier'
              and public.active_membership_tier_order(_profile_id) >= coalesce(min_tier.tier_order, 2147483647)
            )
          )
        )
      )
  );
$$;

create or replace function public.can_read_community_poll(_poll_id uuid, _profile_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1
    from public.community_polls p
    left join public.membership_tiers min_tier on min_tier.id = p.min_tier_id
    where p.id = _poll_id
      and p.is_published
      and (
        p.visibility = 'public'
        or (
          _profile_id is not null
          and public.active_membership_tier_order(_profile_id) is not null
          and (
            p.visibility = 'members'
            or (
              p.visibility = 'tier'
              and public.active_membership_tier_order(_profile_id) >= coalesce(min_tier.tier_order, 2147483647)
            )
          )
        )
      )
  );
$$;

create or replace function public.get_community_poll_results(_poll_id uuid)
returns table (
  option_id uuid,
  votes_count bigint,
  voted_by_me boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  requester uuid := auth.uid();
begin
  if requester is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if not (
    public.can_read_community_poll(_poll_id, requester)
    or public.has_role(requester, 'admin'::public.app_role)
  ) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  return query
  select
    o.id as option_id,
    count(v.id)::bigint as votes_count,
    bool_or(v.profile_id = requester) as voted_by_me
  from public.community_poll_options o
  left join public.community_poll_votes v on v.option_id = o.id
  where o.poll_id = _poll_id
  group by o.id
  order by min(o.option_order), min(o.created_at);
end;
$$;

alter table public.community_live_messages enable row level security;
alter table public.community_polls enable row level security;
alter table public.community_poll_options enable row level security;
alter table public.community_poll_votes enable row level security;

create policy "Readable live messages"
  on public.community_live_messages for select
  to authenticated
  using (
    (
      status = 'visible'
      and public.can_read_community_live_event(live_event_id, (select auth.uid()))
    )
    or public.has_role((select auth.uid()), 'admin'::public.app_role)
  );

create policy "Active members create live messages"
  on public.community_live_messages for insert
  to authenticated
  with check (
    profile_id = (select auth.uid())
    and public.has_active_membership((select auth.uid()))
    and public.can_read_community_live_event(live_event_id, (select auth.uid()))
  );

create policy "Members update their live messages and admins moderate"
  on public.community_live_messages for update
  to authenticated
  using (
    profile_id = (select auth.uid())
    or public.has_role((select auth.uid()), 'admin'::public.app_role)
  )
  with check (
    profile_id = (select auth.uid())
    or public.has_role((select auth.uid()), 'admin'::public.app_role)
  );

create policy "Members delete their live messages and admins moderate"
  on public.community_live_messages for delete
  to authenticated
  using (
    profile_id = (select auth.uid())
    or public.has_role((select auth.uid()), 'admin'::public.app_role)
  );

create policy "Readable community polls anon"
  on public.community_polls for select
  to anon
  using (public.can_read_community_poll(id, null));

create policy "Readable community polls authenticated"
  on public.community_polls for select
  to authenticated
  using (
    public.can_read_community_poll(id, (select auth.uid()))
    or public.has_role((select auth.uid()), 'admin'::public.app_role)
  );

create policy "Admins insert community polls"
  on public.community_polls for insert
  to authenticated
  with check (
    created_by = (select auth.uid())
    and public.has_role((select auth.uid()), 'admin'::public.app_role)
  );

create policy "Admins update community polls"
  on public.community_polls for update
  to authenticated
  using (public.has_role((select auth.uid()), 'admin'::public.app_role))
  with check (public.has_role((select auth.uid()), 'admin'::public.app_role));

create policy "Admins delete community polls"
  on public.community_polls for delete
  to authenticated
  using (public.has_role((select auth.uid()), 'admin'::public.app_role));

create policy "Readable community poll options anon"
  on public.community_poll_options for select
  to anon
  using (public.can_read_community_poll(poll_id, null));

create policy "Readable community poll options authenticated"
  on public.community_poll_options for select
  to authenticated
  using (
    public.can_read_community_poll(poll_id, (select auth.uid()))
    or public.has_role((select auth.uid()), 'admin'::public.app_role)
  );

create policy "Admins insert community poll options"
  on public.community_poll_options for insert
  to authenticated
  with check (public.has_role((select auth.uid()), 'admin'::public.app_role));

create policy "Admins update community poll options"
  on public.community_poll_options for update
  to authenticated
  using (public.has_role((select auth.uid()), 'admin'::public.app_role))
  with check (public.has_role((select auth.uid()), 'admin'::public.app_role));

create policy "Admins delete community poll options"
  on public.community_poll_options for delete
  to authenticated
  using (public.has_role((select auth.uid()), 'admin'::public.app_role));

create policy "Members read their poll votes"
  on public.community_poll_votes for select
  to authenticated
  using (
    profile_id = (select auth.uid())
    or public.has_role((select auth.uid()), 'admin'::public.app_role)
  );

create policy "Active members vote in readable polls"
  on public.community_poll_votes for insert
  to authenticated
  with check (
    profile_id = (select auth.uid())
    and public.has_active_membership((select auth.uid()))
    and public.can_read_community_poll(poll_id, (select auth.uid()))
    and (select coalesce(closes_at > now(), true) from public.community_polls where id = poll_id)
  );

create policy "Members delete their poll votes"
  on public.community_poll_votes for delete
  to authenticated
  using (
    profile_id = (select auth.uid())
    or public.has_role((select auth.uid()), 'admin'::public.app_role)
  );

alter publication supabase_realtime add table public.community_live_events;
alter publication supabase_realtime add table public.community_live_messages;
alter publication supabase_realtime add table public.community_polls;
alter publication supabase_realtime add table public.community_poll_options;
alter publication supabase_realtime add table public.community_poll_votes;

grant select, insert, update, delete on public.community_live_messages to authenticated;
grant select on public.community_polls, public.community_poll_options to anon, authenticated;
grant insert, update, delete on public.community_polls, public.community_poll_options to authenticated;
grant select, insert, delete on public.community_poll_votes to authenticated;

revoke all on function public.get_community_poll_results(uuid) from public, anon, authenticated;
grant execute on function public.get_community_poll_results(uuid) to authenticated;
grant execute on function public.can_read_community_live_event(uuid, uuid) to authenticated;
grant execute on function public.can_read_community_poll(uuid, uuid) to anon, authenticated;
