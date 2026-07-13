alter table public.inbound_emails
  add column if not exists thread_key text,
  add column if not exists in_reply_to text,
  add column if not exists "references" text[] not null default '{}'::text[];

alter table public.sent_emails
  add column if not exists message_id text,
  add column if not exists thread_key text,
  add column if not exists in_reply_to text,
  add column if not exists "references" text[] not null default '{}'::text[];

create index if not exists inbound_emails_thread_key_created_idx
  on public.inbound_emails (thread_key, created_at)
  where thread_key is not null;

create index if not exists inbound_emails_message_id_idx
  on public.inbound_emails (message_id)
  where message_id is not null;

create index if not exists inbound_emails_in_reply_to_idx
  on public.inbound_emails (in_reply_to)
  where in_reply_to is not null;

create index if not exists sent_emails_thread_key_created_idx
  on public.sent_emails (thread_key, created_at)
  where thread_key is not null;

create index if not exists sent_emails_message_id_idx
  on public.sent_emails (message_id)
  where message_id is not null;

create index if not exists sent_emails_in_reply_to_idx
  on public.sent_emails (in_reply_to)
  where in_reply_to is not null;

update public.inbound_emails
set thread_key = 'legacy:' || md5(
  lower(
    trim(
      regexp_replace(
        regexp_replace(coalesce(subject, ''), '^\s*((re|fw|fwd|rif|i)\s*:\s*)+', '', 'i'),
        '\s+',
        ' ',
        'g'
      )
    )
  )
  || '|'
  || array_to_string(
    array(
      select distinct lower(address)
      from unnest(array_append(coalesce(to_addresses, '{}'::text[]), coalesce(from_address, ''))) as address
      where address <> ''
      order by lower(address)
    ),
    '|'
  )
)
where thread_key is null;

update public.sent_emails
set thread_key = 'legacy:' || md5(
  lower(
    trim(
      regexp_replace(
        regexp_replace(coalesce(subject, ''), '^\s*((re|fw|fwd|rif|i)\s*:\s*)+', '', 'i'),
        '\s+',
        ' ',
        'g'
      )
    )
  )
  || '|'
  || array_to_string(
    array(
      select distinct lower(address)
      from unnest(
        array_cat(
          array_append(coalesce(to_addresses, '{}'::text[]), coalesce(from_address, '')),
          array_cat(coalesce(cc_addresses, '{}'::text[]), coalesce(bcc_addresses, '{}'::text[]))
        )
      ) as address
      where address <> ''
      order by lower(address)
    ),
    '|'
  )
)
where thread_key is null;
