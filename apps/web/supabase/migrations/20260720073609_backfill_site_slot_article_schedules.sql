-- Backfill production rows that existed before the scheduling trigger.
-- The first trigger migration updates assigned slots for fresh databases; this
-- direct update handles remotes where that migration already ran before the
-- trigger-fire column list was corrected.

update public.logbook_articles article
set
  status = 'scheduled',
  scheduled_at = public.editorial_plan_slot_scheduled_at(
    slot.slot_date,
    slot.slot_time,
    channel.timezone
  ),
  published_at = null,
  updated_at = timezone('utc', now())
from public.editorial_plan_slots slot
join public.editorial_plan_channels channel
  on channel.id = slot.channel_id
where channel.code = 'site'
  and slot.status = 'assigned'
  and slot.assigned_article_id = article.id
  and article.status <> 'published';
