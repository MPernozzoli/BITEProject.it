-- Track Web Push delivery for admin-facing voyage booking notifications.
-- Email delivery remains recorded in emailed_at; processed_at is set by the
-- dispatcher only after the email path is complete and the admin push path has
-- either been delivered or has no configured/active endpoint to target.

alter table public.voyage_booking_notifications
  add column if not exists push_sent_at timestamptz;
create index if not exists voyage_booking_notifications_push_pending_idx
  on public.voyage_booking_notifications(queued_at)
  where processed_at is null
    and failed_at is null
    and event_type like 'admin_%'
    and push_sent_at is null;
