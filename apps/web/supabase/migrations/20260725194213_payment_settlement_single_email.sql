-- One email per settlement, and it says what happened to the application.
--
-- Until now a settled contribution produced two emails within seconds of each other: the API
-- side queues 'payment_received' ("we got your money") and this function queued the status
-- change ('requested' / 'user_confirmed'), each rendering the same booking summary. Neither
-- one on its own told the payer the whole story: 'payment_received' never mentioned that the
-- candidature had moved to admin review, and 'requested' never mentioned the money.
--
-- The settlement path now folds the outcome into the payment_received notification as
-- metadata.booking_status, which the template renders as a "what happens now" block. The
-- callers in src/server/bunq (status poll and webhook) queue payment_received *before*
-- calling this function precisely so the ON CONFLICT merge below lands on the same row —
-- enqueue_voyage_booking_notification merges metadata (`metadata || excluded.metadata`), so
-- the amount/method/reference queued by the API survive.
--
-- The comped path is unchanged and keeps the plain status-change email: there was no payment,
-- so "payment received" would be a lie.
--
-- Admin-facing notifications (admin_new_booking) are untouched.

create or replace function public.settle_voyage_booking_payment(_booking_request_id uuid)
returns public.voyage_booking_status
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.voyage_booking_requests%rowtype;
  v_is_accepted_invite boolean;
  v_paid boolean;
begin
  select * into v_request
  from public.voyage_booking_requests
  where id = _booking_request_id
  for update;

  if not found then
    raise exception 'booking_not_found' using errcode = '22023';
  end if;

  v_paid := public.voyage_booking_has_paid_deposit(_booking_request_id);

  if v_request.status = 'pending_payment' then
    if not v_paid and not coalesce(v_request.is_comped, false) then
      return v_request.status;
    end if;

    update public.voyage_booking_requests
    set status = 'requested',
        expires_at = null,
        updated_at = timezone('utc', now())
    where id = _booking_request_id;

    if v_paid then
      perform public.enqueue_voyage_booking_notification(
        _booking_request_id,
        'payment_received',
        jsonb_build_object('booking_status', 'requested')
      );
    else
      perform public.enqueue_voyage_booking_notification(_booking_request_id, 'requested');
    end if;

    perform public.enqueue_admin_voyage_booking_notifications(
      _booking_request_id,
      'admin_new_booking',
      jsonb_build_object('status', 'requested')
    );

    return 'requested'::public.voyage_booking_status;
  end if;

  if v_request.status = 'admin_approved' and v_request.party_size = 1 then
    select exists (
      select 1
      from public.voyage_booking_participants participant
      where participant.booking_request_id = _booking_request_id
        and participant.is_lead = false
        and participant.status = 'accepted'
    )
    into v_is_accepted_invite;

    if v_is_accepted_invite then
      if not v_paid and not coalesce(v_request.is_comped, false) then
        return v_request.status;
      end if;

      update public.voyage_booking_requests
      set status = 'user_confirmed',
          confirmed_at = timezone('utc', now()),
          updated_at = timezone('utc', now())
      where id = _booking_request_id;

      if v_paid then
        perform public.enqueue_voyage_booking_notification(
          _booking_request_id,
          'payment_received',
          jsonb_build_object('booking_status', 'user_confirmed')
        );
      else
        perform public.enqueue_voyage_booking_notification(_booking_request_id, 'user_confirmed');
      end if;

      perform public.enqueue_admin_voyage_booking_notifications(
        _booking_request_id,
        'admin_new_booking',
        jsonb_build_object('status', 'user_confirmed')
      );

      return 'user_confirmed'::public.voyage_booking_status;
    end if;
  end if;

  return v_request.status;
end;
$$;

revoke execute on function public.settle_voyage_booking_payment(uuid) from public, anon, authenticated;
grant execute on function public.settle_voyage_booking_payment(uuid) to service_role;
