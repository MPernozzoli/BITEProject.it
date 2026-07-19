create or replace function public.admin_list_community_roles()
returns table (
  profile_id uuid,
  name text,
  email text,
  is_admin boolean,
  is_moderator boolean,
  active_subscription_id uuid,
  active_tier_name text,
  active_period_end timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_role((select auth.uid()), 'admin'::public.app_role) then
    raise exception 'Only admins can list community roles' using errcode = '42501';
  end if;

  return query
  select
    p.id as profile_id,
    p.name,
    p.email,
    exists (
      select 1
      from public.user_roles ur
      where ur.user_id = p.id
        and ur.role = 'admin'::public.app_role
    ) as is_admin,
    exists (
      select 1
      from public.user_roles ur
      where ur.user_id = p.id
        and ur.role = 'moderator'::public.app_role
    ) as is_moderator,
    active_sub.id as active_subscription_id,
    active_tier.name as active_tier_name,
    active_sub.current_period_end as active_period_end
  from public.profiles p
  left join lateral (
    select s.id, s.tier_id, s.current_period_end
    from public.membership_subscriptions s
    where s.profile_id = p.id
      and s.status in ('active', 'trialing', 'past_due')
    order by s.current_period_end desc nulls last, s.updated_at desc
    limit 1
  ) active_sub on true
  left join public.membership_tiers active_tier on active_tier.id = active_sub.tier_id
  where exists (
      select 1
      from public.user_roles ur
      where ur.user_id = p.id
        and ur.role in ('admin'::public.app_role, 'moderator'::public.app_role)
    )
    or active_sub.id is not null
  order by
    exists (
      select 1
      from public.user_roles ur
      where ur.user_id = p.id
        and ur.role = 'admin'::public.app_role
    ) desc,
    exists (
      select 1
      from public.user_roles ur
      where ur.user_id = p.id
        and ur.role = 'moderator'::public.app_role
    ) desc,
    active_sub.current_period_end desc nulls last,
    p.name asc;
end;
$$;

create or replace function public.admin_set_community_moderator(_profile_id uuid, _enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_role((select auth.uid()), 'admin'::public.app_role) then
    raise exception 'Only admins can change community moderators' using errcode = '42501';
  end if;

  if _profile_id is null then
    raise exception 'Missing profile id' using errcode = '22023';
  end if;

  if not exists (select 1 from public.profiles p where p.id = _profile_id) then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  if _enabled then
    insert into public.user_roles (user_id, role)
    select _profile_id, 'moderator'::public.app_role
    where not exists (
      select 1
      from public.user_roles ur
      where ur.user_id = _profile_id
        and ur.role = 'moderator'::public.app_role
    );
  else
    delete from public.user_roles ur
    where ur.user_id = _profile_id
      and ur.role = 'moderator'::public.app_role;
  end if;
end;
$$;

revoke execute on function public.admin_list_community_roles() from public, anon;
grant execute on function public.admin_list_community_roles() to authenticated;

revoke execute on function public.admin_set_community_moderator(uuid, boolean) from public, anon;
grant execute on function public.admin_set_community_moderator(uuid, boolean) to authenticated;
