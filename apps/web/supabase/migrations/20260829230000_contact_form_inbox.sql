-- Contact form submissions now land straight in the mailbox instead of being
-- emailed to hello@ (which came back through the inbound webhook as a message
-- from support@mail.biteproject.it, so replying answered ourselves).
-- `intake_source` marks the rows the contact console at /admin/contatti shows,
-- and keeps them recognisable inside /admin/mail. It is deliberately not called
-- `source`: @pynkstudio/mailapp adds a computed `source` ("inbound" | "sent")
-- to every message it returns, and a column of that name would clash with it.

alter table public.inbound_emails
  add column if not exists intake_source text not null default 'email';

create index if not exists inbound_emails_contact_form_created_idx
  on public.inbound_emails (created_at desc)
  where intake_source = 'contact_form';
