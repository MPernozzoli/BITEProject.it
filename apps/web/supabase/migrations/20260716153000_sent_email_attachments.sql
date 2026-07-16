-- Store metadata for attachments sent from the admin mail console.

alter table public.sent_emails
  add column if not exists attachments jsonb not null default '[]'::jsonb;
