-- BITE Crew community and membership foundation.
-- Isolated from the main public app: no existing booking/article tables are altered here.

create type public.membership_subscription_status as enum (
  'trialing',
  'active',
  'past_due',
  'cancelled',
  'expired'
);

create type public.membership_payment_status as enum (
  'pending',
  'paid',
  'cancelled',
  'failed',
  'refunded'
);

create type public.community_post_status as enum (
  'draft',
  'published',
  'archived'
);

create type public.community_post_visibility as enum (
  'public',
  'members',
  'tier'
);

create table public.membership_tiers (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,60}$'),
  name text not null,
  description text,
  price_cents integer not null check (price_cents >= 0),
  currency text not null default 'EUR' check (currency = upper(currency) and length(currency) = 3),
  billing_interval text not null default 'month' check (billing_interval in ('month', 'year', 'one_time')),
  tier_order integer not null unique check (tier_order >= 0),
  benefits jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.membership_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  tier_id uuid not null references public.membership_tiers(id) on delete restrict,
  status public.membership_subscription_status not null default 'active',
  current_period_start timestamptz not null default now(),
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  cancelled_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index membership_subscriptions_profile_idx on public.membership_subscriptions(profile_id);
create index membership_subscriptions_active_idx
  on public.membership_subscriptions(profile_id, status, current_period_end);

create unique index membership_subscriptions_one_current_per_profile
  on public.membership_subscriptions(profile_id)
  where status in ('trialing', 'active', 'past_due');

create table public.membership_payments (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid references public.membership_subscriptions(id) on delete set null,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  tier_id uuid not null references public.membership_tiers(id) on delete restrict,
  environment text not null default 'production' check (environment in ('production', 'sandbox')),
  payment_method text not null default 'bunq_link' check (payment_method in ('bunq_link', 'bank_transfer')),
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'EUR' check (currency = upper(currency) and length(currency) = 3),
  status public.membership_payment_status not null default 'pending',
  bunq_request_id bigint,
  share_url text,
  reference text not null unique,
  period_start timestamptz not null default now(),
  period_end timestamptz,
  paid_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index membership_payments_profile_idx on public.membership_payments(profile_id, created_at desc);
create index membership_payments_pending_idx on public.membership_payments(status, created_at)
  where status = 'pending';

create table public.membership_benefit_events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  subscription_id uuid references public.membership_subscriptions(id) on delete set null,
  benefit_key text not null,
  target_type text not null,
  target_id uuid,
  value jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index membership_benefit_events_profile_idx
  on public.membership_benefit_events(profile_id, created_at desc);

create table public.community_posts (
  id uuid primary key default gen_random_uuid(),
  author_profile_id uuid not null references public.profiles(id) on delete restrict,
  title_it text not null default '',
  title_en text not null default '',
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,100}$'),
  excerpt_it text not null default '',
  excerpt_en text not null default '',
  content_it jsonb not null default '{}'::jsonb,
  content_en jsonb not null default '{}'::jsonb,
  cover_image text,
  status public.community_post_status not null default 'draft',
  visibility public.community_post_visibility not null default 'members',
  min_tier_id uuid references public.membership_tiers(id) on delete set null,
  published_at timestamptz,
  live_starts_at timestamptz,
  live_ends_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint community_posts_tier_visibility_has_tier
    check (visibility <> 'tier' or min_tier_id is not null)
);

create index community_posts_status_published_idx
  on public.community_posts(status, published_at desc);
create index community_posts_min_tier_idx on public.community_posts(min_tier_id);

create table public.community_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_posts(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  parent_id uuid references public.community_comments(id) on delete cascade,
  content text not null check (char_length(trim(content)) between 1 and 4000),
  is_hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index community_comments_post_idx on public.community_comments(post_id, created_at);
create index community_comments_parent_idx on public.community_comments(parent_id);

create table public.community_reactions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references public.community_posts(id) on delete cascade,
  comment_id uuid references public.community_comments(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  reaction text not null default 'heart' check (reaction in ('heart', 'wave', 'anchor')),
  created_at timestamptz not null default now(),
  constraint community_reactions_one_target
    check ((post_id is not null)::integer + (comment_id is not null)::integer = 1)
);

create unique index community_reactions_one_per_post
  on public.community_reactions(post_id, profile_id, reaction)
  where post_id is not null;
create unique index community_reactions_one_per_comment
  on public.community_reactions(comment_id, profile_id, reaction)
  where comment_id is not null;

create table public.community_live_events (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references public.community_posts(id) on delete set null,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  visibility public.community_post_visibility not null default 'members',
  min_tier_id uuid references public.membership_tiers(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint community_live_events_tier_visibility_has_tier
    check (visibility <> 'tier' or min_tier_id is not null)
);

create index community_live_events_starts_idx on public.community_live_events(starts_at);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger membership_tiers_touch_updated_at
  before update on public.membership_tiers
  for each row execute function public.touch_updated_at();

create trigger membership_subscriptions_touch_updated_at
  before update on public.membership_subscriptions
  for each row execute function public.touch_updated_at();

create trigger membership_payments_touch_updated_at
  before update on public.membership_payments
  for each row execute function public.touch_updated_at();

create trigger community_posts_touch_updated_at
  before update on public.community_posts
  for each row execute function public.touch_updated_at();

create trigger community_comments_touch_updated_at
  before update on public.community_comments
  for each row execute function public.touch_updated_at();

create trigger community_live_events_touch_updated_at
  before update on public.community_live_events
  for each row execute function public.touch_updated_at();

create or replace function public.active_membership_tier_order(_profile_id uuid)
returns integer
language sql
stable
security invoker
set search_path = public
as $$
  select max(t.tier_order)
  from public.membership_subscriptions s
  join public.membership_tiers t on t.id = s.tier_id
  where s.profile_id = _profile_id
    and s.status in ('trialing', 'active')
    and (s.current_period_end is null or s.current_period_end > now())
    and t.is_active;
$$;

create or replace function public.can_read_community_post(_post_id uuid, _profile_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1
    from public.community_posts p
    left join public.membership_tiers min_tier on min_tier.id = p.min_tier_id
    where p.id = _post_id
      and p.status = 'published'
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

create or replace function public.has_active_membership(_profile_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select public.active_membership_tier_order(_profile_id) is not null;
$$;

insert into public.membership_tiers (slug, name, description, price_cents, currency, billing_interval, tier_order, benefits)
values
  ('deck', 'Deck', 'Feed riservato, aggiornamenti live e Q&A periodici.', 700, 'EUR', 'month', 10, '{"community_feed": true, "early_access_hours": 24}'::jsonb),
  ('wake', 'Wake', 'Tutto Deck, piu live/chat di navigazione e contenuti lunghi.', 1500, 'EUR', 'month', 20, '{"community_feed": true, "live_chat": true, "early_access_hours": 72}'::jsonb),
  ('harbor', 'Harbor', 'Tutto Wake, briefing privati e benefit accessori sui viaggi.', 3500, 'EUR', 'month', 30, '{"community_feed": true, "live_chat": true, "private_briefings": true, "early_access_hours": 168, "waive_fixed_minimum_cents": 2000}'::jsonb)
on conflict (slug) do nothing;

alter table public.membership_tiers enable row level security;
alter table public.membership_subscriptions enable row level security;
alter table public.membership_payments enable row level security;
alter table public.membership_benefit_events enable row level security;
alter table public.community_posts enable row level security;
alter table public.community_comments enable row level security;
alter table public.community_reactions enable row level security;
alter table public.community_live_events enable row level security;

create policy "Active tiers are publicly readable"
  on public.membership_tiers for select
  to anon, authenticated
  using (is_active);

create policy "Admins insert membership tiers"
  on public.membership_tiers for insert
  to authenticated
  with check (public.has_role((select auth.uid()), 'admin'::public.app_role));

create policy "Admins update membership tiers"
  on public.membership_tiers for update
  to authenticated
  using (public.has_role((select auth.uid()), 'admin'::public.app_role))
  with check (public.has_role((select auth.uid()), 'admin'::public.app_role));

create policy "Admins delete membership tiers"
  on public.membership_tiers for delete
  to authenticated
  using (public.has_role((select auth.uid()), 'admin'::public.app_role));

create policy "Members read their subscriptions"
  on public.membership_subscriptions for select
  to authenticated
  using (
    profile_id = (select auth.uid())
    or public.has_role((select auth.uid()), 'admin'::public.app_role)
  );

create policy "Admins insert subscriptions"
  on public.membership_subscriptions for insert
  to authenticated
  with check (public.has_role((select auth.uid()), 'admin'::public.app_role));

create policy "Admins update subscriptions"
  on public.membership_subscriptions for update
  to authenticated
  using (public.has_role((select auth.uid()), 'admin'::public.app_role))
  with check (public.has_role((select auth.uid()), 'admin'::public.app_role));

create policy "Admins delete subscriptions"
  on public.membership_subscriptions for delete
  to authenticated
  using (public.has_role((select auth.uid()), 'admin'::public.app_role));

create policy "Members read their membership payments"
  on public.membership_payments for select
  to authenticated
  using (
    profile_id = (select auth.uid())
    or public.has_role((select auth.uid()), 'admin'::public.app_role)
  );

create policy "Admins insert membership payments"
  on public.membership_payments for insert
  to authenticated
  with check (public.has_role((select auth.uid()), 'admin'::public.app_role));

create policy "Admins update membership payments"
  on public.membership_payments for update
  to authenticated
  using (public.has_role((select auth.uid()), 'admin'::public.app_role))
  with check (public.has_role((select auth.uid()), 'admin'::public.app_role));

create policy "Admins delete membership payments"
  on public.membership_payments for delete
  to authenticated
  using (public.has_role((select auth.uid()), 'admin'::public.app_role));

create policy "Members read their benefit events"
  on public.membership_benefit_events for select
  to authenticated
  using (
    profile_id = (select auth.uid())
    or public.has_role((select auth.uid()), 'admin'::public.app_role)
  );

create policy "Admins insert benefit events"
  on public.membership_benefit_events for insert
  to authenticated
  with check (public.has_role((select auth.uid()), 'admin'::public.app_role));

create policy "Admins update benefit events"
  on public.membership_benefit_events for update
  to authenticated
  using (public.has_role((select auth.uid()), 'admin'::public.app_role))
  with check (public.has_role((select auth.uid()), 'admin'::public.app_role));

create policy "Admins delete benefit events"
  on public.membership_benefit_events for delete
  to authenticated
  using (public.has_role((select auth.uid()), 'admin'::public.app_role));

create policy "Public readable community posts"
  on public.community_posts for select
  to anon
  using (public.can_read_community_post(id, null));

create policy "Authenticated readable community posts"
  on public.community_posts for select
  to authenticated
  using (
    public.can_read_community_post(id, (select auth.uid()))
    or public.has_role((select auth.uid()), 'admin'::public.app_role)
  );

create policy "Admins insert community posts"
  on public.community_posts for insert
  to authenticated
  with check (public.has_role((select auth.uid()), 'admin'::public.app_role));

create policy "Admins update community posts"
  on public.community_posts for update
  to authenticated
  using (public.has_role((select auth.uid()), 'admin'::public.app_role))
  with check (public.has_role((select auth.uid()), 'admin'::public.app_role));

create policy "Admins delete community posts"
  on public.community_posts for delete
  to authenticated
  using (public.has_role((select auth.uid()), 'admin'::public.app_role));

create policy "Readable community comments"
  on public.community_comments for select
  to authenticated
  using (
    (
      not is_hidden
      and public.can_read_community_post(post_id, (select auth.uid()))
    )
    or public.has_role((select auth.uid()), 'admin'::public.app_role)
  );

create policy "Active members create comments"
  on public.community_comments for insert
  to authenticated
  with check (
    profile_id = (select auth.uid())
    and public.has_active_membership((select auth.uid()))
    and public.can_read_community_post(post_id, (select auth.uid()))
    and (
      parent_id is null
      or exists (
        select 1
        from public.community_comments parent
        where parent.id = parent_id
          and parent.post_id = post_id
          and not parent.is_hidden
      )
    )
  );

create policy "Members update their comments and admins moderate"
  on public.community_comments for update
  to authenticated
  using (
    profile_id = (select auth.uid())
    or public.has_role((select auth.uid()), 'admin'::public.app_role)
  )
  with check (
    profile_id = (select auth.uid())
    or public.has_role((select auth.uid()), 'admin'::public.app_role)
  );

create policy "Members delete their comments and admins moderate"
  on public.community_comments for delete
  to authenticated
  using (
    profile_id = (select auth.uid())
    or public.has_role((select auth.uid()), 'admin'::public.app_role)
  );

create policy "Readable community reactions"
  on public.community_reactions for select
  to authenticated
  using (
    (
      (post_id is not null and public.can_read_community_post(post_id, (select auth.uid())))
      or (
        comment_id is not null
        and exists (
          select 1 from public.community_comments c
          where c.id = comment_id
            and not c.is_hidden
            and public.can_read_community_post(c.post_id, (select auth.uid()))
        )
      )
    )
    or public.has_role((select auth.uid()), 'admin'::public.app_role)
  );

create policy "Active members create reactions"
  on public.community_reactions for insert
  to authenticated
  with check (
    profile_id = (select auth.uid())
    and public.has_active_membership((select auth.uid()))
    and (
      (post_id is not null and public.can_read_community_post(post_id, (select auth.uid())))
      or (
        comment_id is not null
        and exists (
          select 1 from public.community_comments c
          where c.id = comment_id
            and not c.is_hidden
            and public.can_read_community_post(c.post_id, (select auth.uid()))
        )
      )
    )
  );

create policy "Members delete their reactions"
  on public.community_reactions for delete
  to authenticated
  using (
    profile_id = (select auth.uid())
    or public.has_role((select auth.uid()), 'admin'::public.app_role)
  );

create policy "Readable community live events"
  on public.community_live_events for select
  to authenticated
  using (
    visibility = 'public'
    or (
      public.has_active_membership((select auth.uid()))
      and (
        visibility = 'members'
        or (
          visibility = 'tier'
          and public.active_membership_tier_order((select auth.uid())) >= coalesce(
            (select tier_order from public.membership_tiers where id = min_tier_id),
            2147483647
          )
        )
      )
    )
    or public.has_role((select auth.uid()), 'admin'::public.app_role)
  );

create policy "Admins insert community live events"
  on public.community_live_events for insert
  to authenticated
  with check (public.has_role((select auth.uid()), 'admin'::public.app_role));

create policy "Admins update community live events"
  on public.community_live_events for update
  to authenticated
  using (public.has_role((select auth.uid()), 'admin'::public.app_role))
  with check (public.has_role((select auth.uid()), 'admin'::public.app_role));

create policy "Admins delete community live events"
  on public.community_live_events for delete
  to authenticated
  using (public.has_role((select auth.uid()), 'admin'::public.app_role));

alter publication supabase_realtime add table public.community_posts;
alter publication supabase_realtime add table public.community_comments;
alter publication supabase_realtime add table public.community_reactions;

grant select on public.membership_tiers to anon, authenticated;
grant insert, update, delete on public.membership_tiers to authenticated;
grant select on public.community_posts to anon, authenticated;
grant insert, update, delete on public.community_posts to authenticated;
grant select, insert, update, delete on public.community_comments to authenticated;
grant select, insert, delete on public.community_reactions to authenticated;
grant select on public.community_live_events to authenticated;
grant insert, update, delete on public.community_live_events to authenticated;
grant select on public.membership_subscriptions, public.membership_payments, public.membership_benefit_events to authenticated;
grant insert, update, delete on public.membership_subscriptions, public.membership_payments, public.membership_benefit_events to authenticated;
grant execute on function public.active_membership_tier_order(uuid) to authenticated;
grant execute on function public.has_active_membership(uuid) to authenticated;
grant execute on function public.can_read_community_post(uuid, uuid) to anon, authenticated;
