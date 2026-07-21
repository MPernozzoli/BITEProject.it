-- Pending contribution payments become visible and self-chasing:
--   * deadlines depend on the method — a card/Bunq link is paid in-session (1h), a bank
--     transfer realistically needs a banking day (24h);
--   * bank transfers get reminder emails until the money lands or the deadline passes;
--   * the traveller sees the pending payment in the in-app notification bell.
--
-- Card payments are deliberately NOT reminded by email: the link is paid in the same session
-- or not at all, and a reminder would land after the 1h window had already closed.

-- ---------------------------------------------------------------------------
-- Per-method deadlines
-- ---------------------------------------------------------------------------

create or replace function public.voyage_booking_payment_deadline_hours(_payment_method text)
returns integer
language sql
immutable
as $$
  select case when _payment_method = 'bank_transfer' then 24 else 1 end;
$$;

alter table public.voyage_booking_deposits
  add column if not exists last_reminder_at timestamptz;

comment on column public.voyage_booking_deposits.last_reminder_at is
  'When the last unpaid-bank-transfer reminder was queued; null means none sent yet.';

-- ---------------------------------------------------------------------------
-- Reminder notifications
-- ---------------------------------------------------------------------------

-- Rebuilt from the list in 20260714120000 plus 'payment_reminder'. 'first_briefing' and
-- 'second_briefing' are restored here as well: 20260713003000 installs a trigger that still
-- inserts 'first_briefing' when a participation is accepted, but 20260714120000 dropped both
-- labels from the constraint, so that trigger currently fails with a check violation.
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
      'user_plan_change_resolved'
    )
  );

-- ---------------------------------------------------------------------------
-- Reminder sweep
-- ---------------------------------------------------------------------------

-- A reminder re-arms the single 'payment_reminder' row for this booking rather than inserting
-- a new one: the dispatcher picks up whatever has processed_at null, and the unique index on
-- (booking_request_id, event_type, recipient_profile_id) stays intact — five other call sites
-- rely on it for their own ON CONFLICT clauses, and a partial index would break every one.
create or replace function public.enqueue_voyage_booking_payment_reminders()
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
      d.id as deposit_id,
      d.booking_request_id,
      d.reference,
      d.amount_cents,
      r.profile_id,
      r.expires_at
    from public.voyage_booking_deposits d
    join public.voyage_booking_requests r on r.id = d.booking_request_id
    where d.status = 'pending'
      and d.payment_method = 'bank_transfer'
      and r.profile_id is not null
      and r.status in ('pending_payment', 'requested', 'waitlisted', 'admin_approved', 'user_confirmed')
      -- Still inside the window: chasing a payment we are about to cancel is just noise.
      and (r.expires_at is null or r.expires_at > timezone('utc', now()))
      -- Give the payer a few hours before the first nudge, then every 6h.
      and coalesce(d.last_reminder_at, d.created_at) <= timezone('utc', now()) - interval '6 hours'
  loop
    insert into public.voyage_booking_notifications (
      booking_request_id, recipient_profile_id, event_type, metadata
    )
    values (
      v_rec.booking_request_id,
      v_rec.profile_id,
      'payment_reminder',
      jsonb_build_object(
        'payment_method', 'bank_transfer',
        'reference', v_rec.reference,
        'amount_cents', v_rec.amount_cents,
        'payment_expires_at', v_rec.expires_at
      )
    )
    on conflict (booking_request_id, event_type, recipient_profile_id)
    do update set
      metadata = excluded.metadata,
      queued_at = timezone('utc', now()),
      processed_at = null,
      emailed_at = null,
      failed_at = null,
      error_message = null;

    update public.voyage_booking_deposits
    set last_reminder_at = timezone('utc', now()), updated_at = timezone('utc', now())
    where id = v_rec.deposit_id;

    v_sent := v_sent + 1;
  end loop;

  return v_sent;
end;
$$;

revoke execute on function public.enqueue_voyage_booking_payment_reminders() from public, anon, authenticated;
grant execute on function public.enqueue_voyage_booking_payment_reminders() to service_role;

select cron.schedule(
  'enqueue-voyage-booking-payment-reminders',
  '15 * * * *',
  $$select public.enqueue_voyage_booking_payment_reminders();$$
)
where not exists (
  select 1 from cron.job where jobname = 'enqueue-voyage-booking-payment-reminders'
);

-- ---------------------------------------------------------------------------
-- In-app notification feed
-- ---------------------------------------------------------------------------

create or replace function public.list_my_pending_payments()
returns table (
  booking_request_id uuid,
  voyage_id uuid,
  voyage_name text,
  voyage_name_it text,
  voyage_name_en text,
  booking_status text,
  payment_method text,
  amount_cents integer,
  reference text,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    r.id,
    r.voyage_id,
    v.name,
    v.name_it,
    v.name_en,
    r.status::text,
    d.payment_method,
    d.amount_cents,
    d.reference,
    r.expires_at
  from public.voyage_booking_requests r
  join public.voyages v on v.id = r.voyage_id
  -- The deposit is optional on purpose: an application abandoned before a method was even
  -- chosen is exactly the case the traveller most needs reminding about.
  left join lateral (
    select dep.payment_method, dep.amount_cents, dep.reference
    from public.voyage_booking_deposits dep
    where dep.booking_request_id = r.id
      and dep.status = 'pending'
    order by dep.created_at desc
    limit 1
  ) d on true
  where r.profile_id = auth.uid()
    and (
      r.status = 'pending_payment'
      or (
        d.payment_method is not null
        and r.status in ('requested', 'waitlisted', 'admin_approved', 'user_confirmed')
      )
    )
    and (r.expires_at is null or r.expires_at > timezone('utc', now()))
  order by r.expires_at asc nulls last;
$$;

revoke execute on function public.list_my_pending_payments() from public, anon;
grant execute on function public.list_my_pending_payments() to authenticated;
