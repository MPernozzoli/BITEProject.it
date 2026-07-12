-- Add CC/BCC recipient columns to sent_emails for the admin mail console.

alter table public.sent_emails
  add column if not exists cc_addresses text[] not null default '{}',
  add column if not exists bcc_addresses text[] not null default '{}';
