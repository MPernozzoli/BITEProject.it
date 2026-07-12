-- Booking email flow activation.
--
-- Adds traveller-facing event types for payment and route-plan changes. Existing
-- SQL/RPC code already queues request/approval/confirmation/cancellation events;
-- this migration wires the remaining domain events into the same
-- voyage_booking_notifications -> dispatch-voyage-booking-notifications pipeline.

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
      'admin_new_booking',
      'admin_cancelled',
      'admin_modified',
      'admin_payment_pending',
      'admin_payment_received',
      'admin_plan_change'
    )
  );
create or replace function public.prepare_voyage_booking_plan_change_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'pending_user_approval' then
    new.email_status := 'pending';
  elsif new.status = 'auto_accepted' then
    new.email_status := 'skipped';
  end if;

  return new;
end;
$$;
drop trigger if exists prepare_voyage_booking_plan_change_email_before_insert
  on public.voyage_booking_plan_changes;
create trigger prepare_voyage_booking_plan_change_email_before_insert
  before insert on public.voyage_booking_plan_changes
  for each row execute function public.prepare_voyage_booking_plan_change_email();
create or replace function public.enqueue_voyage_booking_plan_change_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'pending_user_approval' then
    perform public.enqueue_voyage_booking_notification(
      new.booking_request_id,
      'plan_change_pending',
      coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
        'plan_change_id', new.id,
        'change_kind', new.change_kind,
        'old_from_waypoint_id', new.old_from_waypoint_id,
        'old_to_waypoint_id', new.old_to_waypoint_id,
        'proposed_from_waypoint_id', new.proposed_from_waypoint_id,
        'proposed_to_waypoint_id', new.proposed_to_waypoint_id,
        'old_leg_ids', new.old_leg_ids,
        'proposed_leg_ids', new.proposed_leg_ids
      )
    );

    perform public.enqueue_admin_voyage_booking_notifications(
      new.booking_request_id,
      'admin_plan_change',
      jsonb_build_object(
        'plan_change_id', new.id,
        'change_kind', new.change_kind,
        'old_from_waypoint_id', new.old_from_waypoint_id,
        'old_to_waypoint_id', new.old_to_waypoint_id,
        'proposed_from_waypoint_id', new.proposed_from_waypoint_id,
        'proposed_to_waypoint_id', new.proposed_to_waypoint_id,
        'old_leg_ids', new.old_leg_ids,
        'proposed_leg_ids', new.proposed_leg_ids
      )
    );
  end if;

  return new;
end;
$$;
drop trigger if exists enqueue_voyage_booking_plan_change_email_after_insert
  on public.voyage_booking_plan_changes;
create trigger enqueue_voyage_booking_plan_change_email_after_insert
  after insert on public.voyage_booking_plan_changes
  for each row execute function public.enqueue_voyage_booking_plan_change_email();
update public.voyage_booking_plan_changes
set email_status = 'pending'
where status = 'pending_user_approval'
  and email_status = 'not_configured';
insert into public.voyage_booking_notifications (
  booking_request_id,
  recipient_profile_id,
  event_type,
  metadata
)
select
  change.booking_request_id,
  request.profile_id,
  'plan_change_pending',
  coalesce(change.metadata, '{}'::jsonb) || jsonb_build_object(
    'plan_change_id', change.id,
    'change_kind', change.change_kind,
    'old_from_waypoint_id', change.old_from_waypoint_id,
    'old_to_waypoint_id', change.old_to_waypoint_id,
    'proposed_from_waypoint_id', change.proposed_from_waypoint_id,
    'proposed_to_waypoint_id', change.proposed_to_waypoint_id,
    'old_leg_ids', change.old_leg_ids,
    'proposed_leg_ids', change.proposed_leg_ids
  )
from public.voyage_booking_plan_changes change
join public.voyage_booking_requests request on request.id = change.booking_request_id
where change.status = 'pending_user_approval'
  and change.email_status = 'pending'
on conflict (booking_request_id, event_type, recipient_profile_id)
do update set
  metadata = voyage_booking_notifications.metadata || excluded.metadata,
  processed_at = null,
  emailed_at = null,
  failed_at = null,
  error_message = null;
revoke execute on function public.prepare_voyage_booking_plan_change_email() from public, anon, authenticated;
revoke execute on function public.enqueue_voyage_booking_plan_change_email() from public, anon, authenticated;
grant execute on function public.prepare_voyage_booking_plan_change_email() to service_role;
grant execute on function public.enqueue_voyage_booking_plan_change_email() to service_role;
