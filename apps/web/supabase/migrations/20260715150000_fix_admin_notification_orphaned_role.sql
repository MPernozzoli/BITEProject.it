-- Fix: a dangling admin grant took the whole booking system down.
--
-- enqueue_admin_voyage_booking_notifications loops over every user_roles row with
-- role='admin' and inserts a notification per admin, with no check that the user
-- still exists. public.user_roles holds a row for fcc656b6-b2db-4e0e-864f-aaf8c6ff326f,
-- which has neither a profiles row nor an auth.users row. Since
-- voyage_booking_notifications.recipient_profile_id is a foreign key to profiles,
-- every call raised foreign_key_violation and aborted the caller's transaction.
--
-- Ten functions call it, including request_voyage_booking, confirm_voyage_booking
-- and cancel_voyage_booking, so in practice nobody could create, confirm or cancel
-- a booking at all.
--
-- A notification is addressed to a profile, so an admin without one is not a
-- recipient: joining profiles is the honest rule, not a workaround. The orphaned
-- user_roles row is left in place — removing a role grant is the owner's call, and
-- with this join it is inert.

create or replace function public.enqueue_admin_voyage_booking_notifications(
  _booking_request_id uuid,
  _event_type text,
  _metadata jsonb default '{}'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_id uuid;
  sent_count integer := 0;
begin
  for admin_id in
    select ur.user_id
    from public.user_roles ur
    join public.profiles p on p.id = ur.user_id
    where ur.role = 'admin'::public.app_role
  loop
    insert into public.voyage_booking_notifications (
      booking_request_id,
      recipient_profile_id,
      event_type,
      metadata
    )
    values (
      _booking_request_id,
      admin_id,
      _event_type,
      coalesce(_metadata, '{}'::jsonb)
    )
    on conflict (booking_request_id, event_type, recipient_profile_id)
    do update set
      metadata = voyage_booking_notifications.metadata || excluded.metadata,
      processed_at = null,
      emailed_at = null,
      failed_at = null,
      error_message = null;

    sent_count := sent_count + 1;
  end loop;

  return sent_count;
end;
$$;

revoke execute on function public.enqueue_admin_voyage_booking_notifications(uuid, text, jsonb) from public, anon;
grant execute on function public.enqueue_admin_voyage_booking_notifications(uuid, text, jsonb) to service_role;

comment on function public.enqueue_admin_voyage_booking_notifications(uuid, text, jsonb) is
  'Queues a booking notification for every admin that has a profile. Admins without one are skipped: the queue addresses profiles, and recipient_profile_id is a foreign key to them.';
