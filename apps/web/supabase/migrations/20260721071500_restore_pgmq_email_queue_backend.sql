-- Restore the email queue backend. pgmq had been uninstalled and the four wrapper
-- functions replaced with no-op stubs, so every transactional email was silently
-- discarded at enqueue and process-email-queue always read 0 messages. This reinstalls
-- pgmq, recreates the queues, and reimplements the wrappers with the exact signatures
-- the edge functions call.

create extension if not exists pgmq;

-- Recreate the queues (idempotent) used by process-email-queue + its DLQs.
do $$
declare q text;
begin
  foreach q in array array['auth_emails','transactional_emails','auth_emails_dlq','transactional_emails_dlq'] loop
    if not exists (select 1 from pgmq.list_queues() where queue_name = q) then
      perform pgmq.create(q);
    end if;
  end loop;
end $$;

-- enqueue_email(queue_name, payload) -> pgmq.send
create or replace function public.enqueue_email(queue_name text, payload jsonb)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'pgmq'
as $function$
declare new_id bigint;
begin
  select s into new_id from pgmq.send(queue_name, payload) as s;
  return new_id;
end;
$function$;

-- read_email_batch(queue_name, vt, batch_size) -> pgmq.read
create or replace function public.read_email_batch(queue_name text, vt integer, batch_size integer)
returns table(msg_id bigint, read_ct integer, message jsonb)
language plpgsql
security definer
set search_path to 'public', 'pgmq'
as $function$
begin
  return query
    select r.msg_id, r.read_ct, r.message
    from pgmq.read(queue_name, vt, batch_size) as r;
end;
$function$;

-- delete_email(queue_name, message_id) -> pgmq.delete
create or replace function public.delete_email(queue_name text, message_id bigint)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pgmq'
as $function$
begin
  return pgmq.delete(queue_name, message_id);
end;
$function$;

-- move_to_dlq(source_queue, dlq_name, message_id, payload) -> send to DLQ, delete source
create or replace function public.move_to_dlq(source_queue text, dlq_name text, message_id bigint, payload jsonb)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'pgmq'
as $function$
declare new_id bigint;
begin
  select s into new_id from pgmq.send(dlq_name, payload) as s;
  perform pgmq.delete(source_queue, message_id);
  return new_id;
end;
$function$;

-- Lock down execution to the service role (edge functions call via service_role).
revoke execute on function public.enqueue_email(text, jsonb) from public, anon, authenticated;
revoke execute on function public.read_email_batch(text, integer, integer) from public, anon, authenticated;
revoke execute on function public.delete_email(text, bigint) from public, anon, authenticated;
revoke execute on function public.move_to_dlq(text, text, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.enqueue_email(text, jsonb) to service_role;
grant execute on function public.read_email_batch(text, integer, integer) to service_role;
grant execute on function public.delete_email(text, bigint) to service_role;
grant execute on function public.move_to_dlq(text, text, bigint, jsonb) to service_role;
