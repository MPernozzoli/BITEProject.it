insert into public.system_email_automations (key, enabled, config)
values ('story-new-article-notification', true, '{}'::jsonb)
on conflict (key) do nothing;
