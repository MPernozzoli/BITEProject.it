do $$
begin
  if to_regclass('public.newsletter_messages') is not null then
    execute 'alter table public.newsletter_messages enable row level security';

    if not exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'newsletter_messages'
        and policyname = 'Admins can view newsletter messages'
    ) then
      execute $policy$
        create policy "Admins can view newsletter messages"
          on public.newsletter_messages
          for select
          to authenticated
          using (public.has_role(auth.uid(), 'admin'::app_role))
      $policy$;
    end if;

    if not exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'newsletter_messages'
        and policyname = 'Admins can manage newsletter messages'
    ) then
      execute $policy$
        create policy "Admins can manage newsletter messages"
          on public.newsletter_messages
          for all
          to authenticated
          using (public.has_role(auth.uid(), 'admin'::app_role))
          with check (public.has_role(auth.uid(), 'admin'::app_role))
      $policy$;
    end if;
  end if;

  if to_regclass('public.newsletter_deliveries') is not null then
    execute 'alter table public.newsletter_deliveries enable row level security';

    if not exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'newsletter_deliveries'
        and policyname = 'Admins can view newsletter deliveries'
    ) then
      execute $policy$
        create policy "Admins can view newsletter deliveries"
          on public.newsletter_deliveries
          for select
          to authenticated
          using (public.has_role(auth.uid(), 'admin'::app_role))
      $policy$;
    end if;
  end if;

  if to_regclass('public.newsletter_events') is not null then
    execute 'alter table public.newsletter_events enable row level security';

    if not exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'newsletter_events'
        and policyname = 'Admins can view newsletter events'
    ) then
      execute $policy$
        create policy "Admins can view newsletter events"
          on public.newsletter_events
          for select
          to authenticated
          using (public.has_role(auth.uid(), 'admin'::app_role))
      $policy$;
    end if;
  end if;
end
$$;
