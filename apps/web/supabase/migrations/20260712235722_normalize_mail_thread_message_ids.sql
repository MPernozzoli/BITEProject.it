update public.inbound_emails
set
  message_id = nullif(lower(regexp_replace(regexp_replace(trim(message_id), '^<+', ''), '>+$', '')), ''),
  in_reply_to = nullif(lower(regexp_replace(regexp_replace(trim(in_reply_to), '^<+', ''), '>+$', '')), '')
where message_id is not null
   or in_reply_to is not null;

update public.inbound_emails
set "references" = coalesce(
  array(
    select distinct nullif(lower(regexp_replace(regexp_replace(trim(value), '^<+', ''), '>+$', '')), '')
    from unnest("references") as value
    where nullif(lower(regexp_replace(regexp_replace(trim(value), '^<+', ''), '>+$', '')), '') is not null
    order by nullif(lower(regexp_replace(regexp_replace(trim(value), '^<+', ''), '>+$', '')), '')
  ),
  '{}'::text[]
)
where cardinality("references") > 0;

update public.sent_emails
set
  message_id = nullif(lower(regexp_replace(regexp_replace(trim(message_id), '^<+', ''), '>+$', '')), ''),
  in_reply_to = nullif(lower(regexp_replace(regexp_replace(trim(in_reply_to), '^<+', ''), '>+$', '')), '')
where message_id is not null
   or in_reply_to is not null;

update public.sent_emails
set "references" = coalesce(
  array(
    select distinct nullif(lower(regexp_replace(regexp_replace(trim(value), '^<+', ''), '>+$', '')), '')
    from unnest("references") as value
    where nullif(lower(regexp_replace(regexp_replace(trim(value), '^<+', ''), '>+$', '')), '') is not null
    order by nullif(lower(regexp_replace(regexp_replace(trim(value), '^<+', ''), '>+$', '')), '')
  ),
  '{}'::text[]
)
where cardinality("references") > 0;
