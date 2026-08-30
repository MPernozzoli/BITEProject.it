-- The mailapp send handler loads the reply target with a shared column list that
-- includes cc_addresses (see @pynkstudio/mailapp loadReplyTarget). inbound_emails
-- never had the column, so replying to an inbound message failed with 42703.

alter table public.inbound_emails
  add column if not exists cc_addresses text[] not null default '{}';
