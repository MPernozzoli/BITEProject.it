-- Voyage briefing emails.
--
-- Splits the old single briefing field into first/second bilingual briefing
-- emails and queues the first briefing as soon as a traveller's participation is
-- confirmed.

alter table public.voyage_booking_settings
  add column if not exists first_briefing_content_it text,
  add column if not exists first_briefing_content_en text,
  add column if not exists second_briefing_content_it text,
  add column if not exists second_briefing_content_en text;

update public.voyage_booking_settings
set
  first_briefing_content_it = coalesce(first_briefing_content_it, briefing_content_it),
  first_briefing_content_en = coalesce(first_briefing_content_en, briefing_content_en)
where briefing_content_it is not null
   or briefing_content_en is not null;

alter table public.voyage_booking_notifications
  drop constraint if exists voyage_booking_notifications_event_type_check;
alter table public.voyage_booking_notifications
  add constraint voyage_booking_notifications_event_type_check check (
    event_type in (
      'requested',
      'waitlisted',
      'admin_approved',
      'user_confirmed',
      'cancelled',
      'rejected',
      'promoted_from_waitlist',
      'manual_added',
      'payment_pending',
      'payment_received',
      'payment_failed',
      'payment_expired',
      'plan_change_pending',
      'plan_change_auto_accepted',
      'first_briefing',
      'second_briefing',
      'admin_new_booking',
      'admin_cancelled',
      'admin_modified',
      'admin_payment_pending',
      'admin_payment_received',
      'admin_plan_change'
    )
  );

create or replace function public.enqueue_first_voyage_briefing_for_booking()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'user_confirmed'
     and (tg_op = 'INSERT' or old.status is distinct from new.status)
     and new.profile_id is not null
  then
    perform public.enqueue_voyage_booking_notification(
      new.id,
      'first_briefing',
      jsonb_build_object('source', 'booking_confirmed')
    );
  end if;

  return new;
end;
$$;

drop trigger if exists enqueue_first_voyage_briefing_for_booking_after_write
  on public.voyage_booking_requests;
create trigger enqueue_first_voyage_briefing_for_booking_after_write
  after insert or update of status on public.voyage_booking_requests
  for each row execute function public.enqueue_first_voyage_briefing_for_booking();

create or replace function public.enqueue_first_voyage_briefing_for_participant()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'accepted'
     and (tg_op = 'INSERT' or old.status is distinct from new.status)
     and new.profile_id is not null
  then
    insert into public.voyage_booking_notifications (
      booking_request_id,
      recipient_profile_id,
      event_type,
      metadata
    )
    values (
      new.booking_request_id,
      new.profile_id,
      'first_briefing',
      jsonb_build_object('source', 'participant_accepted', 'participant_id', new.id)
    )
    on conflict (booking_request_id, event_type, recipient_profile_id)
    do update set
      metadata = voyage_booking_notifications.metadata || excluded.metadata,
      failed_at = null,
      error_message = null;
  end if;

  return new;
end;
$$;

drop trigger if exists enqueue_first_voyage_briefing_for_participant_after_write
  on public.voyage_booking_participants;
create trigger enqueue_first_voyage_briefing_for_participant_after_write
  after insert or update of status, profile_id on public.voyage_booking_participants
  for each row execute function public.enqueue_first_voyage_briefing_for_participant();

revoke execute on function public.enqueue_first_voyage_briefing_for_booking() from public, anon, authenticated;
revoke execute on function public.enqueue_first_voyage_briefing_for_participant() from public, anon, authenticated;
grant execute on function public.enqueue_first_voyage_briefing_for_booking() to service_role;
grant execute on function public.enqueue_first_voyage_briefing_for_participant() to service_role;
