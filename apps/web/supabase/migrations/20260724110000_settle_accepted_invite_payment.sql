-- An admin email invite is born admin_approved (the admin already chose this specific
-- person) and stays admin_approved after the guest accepts, even when they still owe their
-- contribution ('each_pays_own', not comped) — nothing distinguished "accepted and paid" from
-- "accepted but unpaid". The seat must stay reserved for the invitee throughout (unlike a
-- self-service candidature, which deliberately holds no seat while 'pending_payment'), so this
-- does NOT introduce a new voyage_booking_status value — that would require touching every one
-- of the many call sites that already treat ('admin_approved', 'user_confirmed') as
-- seat-holding (capacity, refunds, public availability, approval gates), which is too risky to
-- get right everywhere for a booking/payment/refund system. Instead, status stays
-- 'admin_approved' (already seat-holding, unchanged) and "paid or not" is tracked purely via
-- the existing voyage_booking_deposits / voyage_booking_has_paid_deposit machinery; the UI
-- layer is what shows "awaiting payment" vs "confirmed".
--
-- This adds a second branch to settle_voyage_booking_payment — the single choke point already
-- called by clearBookingPaymentDeadlineIfSettled (src/server/bunq/deposit-resolver.ts) on every
-- settlement, so no server/TypeScript changes are needed. The existing
-- pending_payment -> requested branch (self-service candidatures) is untouched.

create or replace function public.settle_voyage_booking_payment(_booking_request_id uuid)
returns public.voyage_booking_status
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.voyage_booking_requests%rowtype;
  v_is_accepted_invite boolean;
begin
  select * into v_request
  from public.voyage_booking_requests
  where id = _booking_request_id
  for update;

  if not found then
    raise exception 'booking_not_found' using errcode = '22023';
  end if;

  if v_request.status = 'pending_payment' then
    if not public.voyage_booking_has_paid_deposit(_booking_request_id)
       and not coalesce(v_request.is_comped, false)
    then
      return v_request.status;
    end if;

    update public.voyage_booking_requests
    set status = 'requested',
        expires_at = null,
        updated_at = timezone('utc', now())
    where id = _booking_request_id;

    perform public.enqueue_voyage_booking_notification(_booking_request_id, 'requested');
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
      if not public.voyage_booking_has_paid_deposit(_booking_request_id)
         and not coalesce(v_request.is_comped, false)
      then
        return v_request.status;
      end if;

      update public.voyage_booking_requests
      set status = 'user_confirmed',
          confirmed_at = timezone('utc', now()),
          updated_at = timezone('utc', now())
      where id = _booking_request_id;

      perform public.enqueue_voyage_booking_notification(_booking_request_id, 'user_confirmed');
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
