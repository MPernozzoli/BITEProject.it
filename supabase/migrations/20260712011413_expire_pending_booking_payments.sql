-- Expire active voyage bookings that are waiting on a pending contribution payment.
-- Admin-approval pending bookings do not expire unless a pending payment has been created.

create or replace function public.expire_pending_voyage_booking_payments()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_expired integer := 0;
  v_rec record;
  v_leg_ids uuid[];
begin
  for v_rec in
    select distinct r.id, r.voyage_id
    from public.voyage_booking_requests r
    join public.voyage_booking_deposits d
      on d.booking_request_id = r.id
     and d.status = 'pending'
    where r.status in ('requested', 'waitlisted', 'admin_approved', 'user_confirmed')
      and (
        (r.expires_at is not null and r.expires_at <= timezone('utc', now()))
        or d.created_at <= timezone('utc', now()) - interval '2 days'
      )
  loop
    select array_agg(bookable_leg_id)
    into v_leg_ids
    from public.voyage_booking_request_legs
    where booking_request_id = v_rec.id;

    update public.voyage_booking_requests
    set
      status = 'cancelled',
      cancelled_at = coalesce(cancelled_at, timezone('utc', now())),
      expires_at = null,
      updated_at = timezone('utc', now())
    where id = v_rec.id
      and status in ('requested', 'waitlisted', 'admin_approved', 'user_confirmed');

    if found then
      update public.voyage_booking_deposits
      set status = 'cancelled', updated_at = timezone('utc', now())
      where booking_request_id = v_rec.id
        and status = 'pending';

      perform public.enqueue_voyage_booking_notification(v_rec.id, 'payment_expired');
      perform public.enqueue_admin_voyage_booking_notifications(
        v_rec.id,
        'admin_cancelled',
        jsonb_build_object('reason', 'payment_expired')
      );
      perform public.promote_waitlisted_voyage_bookings(v_rec.voyage_id, coalesce(v_leg_ids, array[]::uuid[]));

      v_expired := v_expired + 1;
    end if;
  end loop;

  return v_expired;
end;
$$;

revoke execute on function public.expire_pending_voyage_booking_payments() from public, anon, authenticated;
grant execute on function public.expire_pending_voyage_booking_payments() to service_role;

-- Legacy booking-request deadlines were used for generic holds. From now on `expires_at`
-- represents only an active payment deadline, so admin-only pending requests must stay open.
update public.voyage_booking_requests r
set expires_at = null, updated_at = timezone('utc', now())
where r.status in ('requested', 'waitlisted', 'admin_approved', 'user_confirmed')
  and r.expires_at is not null
  and not exists (
    select 1
    from public.voyage_booking_deposits d
    where d.booking_request_id = r.id
      and d.status = 'pending'
  );

select cron.schedule(
  'expire-pending-voyage-booking-payments',
  '0 * * * *',
  $$select public.expire_pending_voyage_booking_payments();$$
)
where not exists (
  select 1
  from cron.job
  where jobname = 'expire-pending-voyage-booking-payments'
);
