-- "Biglietto ricordo" ready email.
--
-- Each confirmed traveller gets a personal email with a direct link to their
-- voyage ticket (planned vs actual miles/stops for the leg(s) they booked —
-- see src/lib/voyage-tickets.ts), sent the day after the voyage actually
-- moves on without them: not when they arrive at their disembarkation stop,
-- but when that waypoint's actual_departure_at is logged. Arriving does not
-- close the story; the boat leaving without them does.
--
-- This is per-PARTICIPANT, not per booking request: a party of several people
-- shares the same legs, but each gets their own email at their own address.
-- voyage_booking_notifications was widened to (booking_request_id, event_type,
-- recipient_profile_id) in 20260721150000_pending_payment_reminders.sql
-- specifically so several recipients can share one (request, event_type) pair
-- without colliding — this reuses that, inserting one row per participant
-- directly rather than going through enqueue_voyage_booking_notification
-- (which only ever resolves the lead booker's profile_id).

alter table public.voyage_booking_participants
  add column if not exists ticket_email_sent_at timestamptz;

comment on column public.voyage_booking_participants.ticket_email_sent_at is
  'When the "your voyage ticket is ready" email was queued for this participant; null means not sent yet.';

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
      'payment_reminder',
      'plan_change_pending',
      'plan_change_auto_accepted',
      'first_briefing',
      'second_briefing',
      'admin_new_booking',
      'admin_cancelled',
      'admin_modified',
      'admin_payment_pending',
      'admin_payment_received',
      'admin_plan_change',
      'user_plan_change_requested',
      'user_plan_change_resolved',
      'balance_reminder',
      'balance_deadline_missed',
      'admin_balance_deadline_missed',
      'contribution_proposal_received',
      'contribution_proposal_accepted',
      'contribution_proposal_countered',
      'contribution_proposal_rejected',
      'admin_contribution_proposal_received',
      'admin_contribution_proposal_resolved',
      'guest_share_due',
      'guest_share_overdue',
      'guest_share_dropped',
      'admin_guest_share_overdue',
      'contribution_settlement_deadline_missed',
      'admin_contribution_settlement_deadline_missed',
      'late_payment_after_cancellation',
      'admin_late_payment_after_cancellation',
      -- New: the traveller's ticket for their booked leg is ready (see function below).
      'voyage_ticket_ready'
    )
  );

-- One participant's ticket becomes ready when the *last* leg they booked
-- reaches its destination waypoint and the voyage then departs from it —
-- i.e. that waypoint's actual_departure_at gets logged. Runs once a day, so
-- "the day after" is exactly the next run to see that date in the past.
create or replace function public.enqueue_voyage_ticket_ready_notifications()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sent integer := 0;
  v_rec record;
begin
  for v_rec in
    select
      p.id as participant_id,
      p.profile_id,
      r.id as booking_request_id
    from public.voyage_booking_participants p
    join public.voyage_booking_requests r on r.id = p.booking_request_id
    join public.voyage_booking_request_legs rl on rl.booking_request_id = r.id
    join public.voyage_bookable_legs leg on leg.id = rl.bookable_leg_id
    join public.voyage_waypoints w on w.id = leg.to_waypoint_id
    where p.status = 'accepted'
      and p.profile_id is not null
      and p.ticket_email_sent_at is null
      and r.status = 'user_confirmed'
      -- only the participant's disembarkation leg (the last one they booked) decides this
      and leg.sort_order = (
        select max(leg2.sort_order)
        from public.voyage_booking_request_legs rl2
        join public.voyage_bookable_legs leg2 on leg2.id = rl2.bookable_leg_id
        where rl2.booking_request_id = r.id
      )
      and w.actual_departure_at is not null
      and (timezone('Europe/Rome', w.actual_departure_at))::date
        <= (timezone('Europe/Rome', timezone('utc', now())))::date - 1
  loop
    insert into public.voyage_booking_notifications (
      booking_request_id, recipient_profile_id, event_type, metadata
    )
    values (
      v_rec.booking_request_id,
      v_rec.profile_id,
      'voyage_ticket_ready',
      jsonb_build_object('participant_id', v_rec.participant_id)
    )
    on conflict (booking_request_id, event_type, recipient_profile_id) do nothing;

    update public.voyage_booking_participants
    set ticket_email_sent_at = timezone('utc', now())
    where id = v_rec.participant_id;

    v_sent := v_sent + 1;
  end loop;

  return v_sent;
end;
$$;

revoke execute on function public.enqueue_voyage_ticket_ready_notifications() from public, anon, authenticated;
grant execute on function public.enqueue_voyage_ticket_ready_notifications() to service_role;

select cron.schedule(
  'enqueue-voyage-ticket-ready-notifications',
  '0 6 * * *',
  $$select public.enqueue_voyage_ticket_ready_notifications();$$
)
where not exists (
  select 1 from cron.job where jobname = 'enqueue-voyage-ticket-ready-notifications'
);
