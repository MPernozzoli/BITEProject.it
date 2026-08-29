-- The two-day window covers every guest who pays their own way, not only negotiated bookings.
--
-- It shipped scoped to bookings that had gone through a contribution negotiation, which is how
-- the feature was first described. That leaves the ordinary case unguarded: a guest accepts an
-- invitation on a plain each_pays_own booking, never pays, and holds a seat until
-- expire_unpaid_voyage_booking_guest_shares fires — fifteen days before departure. On a voyage
-- planned six months out that is half a year of a held, unpaid seat, with the booker given no
-- lever and the organiser no signal. The rule as originally put was about "a member who does not
-- complete payment in time", with no mention of negotiation; this is that rule.
--
-- The subtlety that shapes the implementation: for a guest who never opened the payment flow,
-- resolveDepositPayer has never stamped contribution_due_cents, so SQL genuinely cannot say what
-- they owe — the mileage formula is TypeScript. That is exactly the person the sweep must catch.
-- So "paid nothing at all after the deadline" counts on its own, needing no amount; the precise
-- comparison is kept for partial payments, where the figure is necessarily known because a
-- payment was started.
--
-- lead_drop_unpaid_guest_share needs no change: it already refuses only when the share is known
-- AND fully paid, so it permits the drop when nothing was ever paid. A null due always implies
-- zero paid, since any payment stamps the figure first.

create or replace function public.notify_leads_of_overdue_guest_shares()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_notified integer := 0;
  v_rec record;
begin
  for v_rec in
    select p.id as participant_id,
           p.booking_request_id,
           trim(concat_ws(' ', p.first_name, p.last_name)) as guest_name,
           p.email as guest_email
    from public.voyage_booking_participants p
    join public.voyage_booking_requests r on r.id = p.booking_request_id
    where p.is_lead = false
      and p.status = 'accepted'
      and p.share_payment_due_at is not null
      and p.share_payment_due_at <= timezone('utc', now())
      and p.share_overdue_notified_at is null
      and r.payment_mode = 'each_pays_own'
      and r.status in ('requested', 'waitlisted', 'admin_approved', 'user_confirmed')
      and coalesce(r.is_comped, false) = false
      and (
        -- Nothing arrived at all. This is the case the sweep most needs to catch and the one
        -- where the amount is unknowable here: a guest who never opened the payment flow has no
        -- contribution_due_cents stamped, and the mileage formula lives in booking-deposit.ts,
        -- not in SQL. Zero paid after the deadline is delinquent whatever the exact figure is.
        coalesce((
          select sum(d.amount_cents) from public.voyage_booking_deposits d
          where d.booking_request_id = r.id and d.participant_id = p.id and d.status = 'paid'
        ), 0) = 0
        -- Something arrived but not enough — only checkable once the figure is known, which it
        -- is precisely because a payment was started.
        or (
          public.voyage_booking_guest_share_due_cents(r.id, p.id) is not null
          and coalesce((
            select sum(d.amount_cents) from public.voyage_booking_deposits d
            where d.booking_request_id = r.id and d.participant_id = p.id and d.status = 'paid'
          ), 0) < public.voyage_booking_guest_share_due_cents(r.id, p.id)
        )
      )
  loop
    update public.voyage_booking_participants
    set share_overdue_notified_at = timezone('utc', now()),
        updated_at = timezone('utc', now())
    where id = v_rec.participant_id
      and share_overdue_notified_at is null;

    if not found then
      continue;
    end if;

    -- Goes to the booking owner: they are the one who chooses between dropping this person and
    -- calling the whole thing off.
    perform public.enqueue_voyage_booking_notification(
      v_rec.booking_request_id,
      'guest_share_overdue',
      jsonb_build_object(
        'participant_id', v_rec.participant_id,
        'guest_name', nullif(v_rec.guest_name, ''),
        'guest_email', v_rec.guest_email
      )
    );
    perform public.enqueue_admin_voyage_booking_notifications(
      v_rec.booking_request_id,
      'admin_guest_share_overdue',
      jsonb_build_object('participant_id', v_rec.participant_id, 'guest_email', v_rec.guest_email)
    );

    v_notified := v_notified + 1;
  end loop;

  return v_notified;
end;
$$;

revoke execute on function public.notify_leads_of_overdue_guest_shares() from public, anon, authenticated;
grant execute on function public.notify_leads_of_overdue_guest_shares() to service_role;

create or replace function public.accept_booking_participation(
  _participant_id uuid,
  _candidate_info jsonb default '{}'::jsonb
)
returns public.voyage_booking_participants
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.voyage_booking_participants%rowtype;
  v_request public.voyage_booking_requests%rowtype;
begin
  select * into v_row
  from public.voyage_booking_participants
  where id = _participant_id;

  if not found then
    raise exception 'participation_not_found';
  end if;
  if v_row.profile_id <> auth.uid()
     and lower(v_row.email) <> lower(coalesce(auth.jwt() ->> 'email', '')) then
    raise exception 'not_your_participation';
  end if;
  if v_row.status not in ('pending') then
    raise exception 'participation_not_pending';
  end if;

  if not exists (select 1 from public.profiles where id = auth.uid()) then
    insert into public.profiles (id, email, name)
    select
      u.id,
      coalesce(u.email, v_row.email, ''),
      coalesce(
        nullif(trim(u.raw_user_meta_data ->> 'name'), ''),
        nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''),
        nullif(trim(concat_ws(' ', v_row.first_name, v_row.last_name)), ''),
        nullif(split_part(coalesce(u.email, v_row.email, ''), '@', 1), ''),
        'Guest'
      )
    from auth.users u
    where u.id = auth.uid()
    on conflict (id) do nothing;
  end if;

  select * into v_request
  from public.voyage_booking_requests
  where id = v_row.booking_request_id;

  update public.voyage_booking_participants
  set profile_id = auth.uid(),
      status = 'accepted',
      candidate_info = case
        when jsonb_typeof(coalesce(_candidate_info, '{}'::jsonb)) = 'object' then coalesce(_candidate_info, '{}'::jsonb)
        else '{}'::jsonb
      end,
      conditions_accepted_at = timezone('utc', now()),
      accepted_at = timezone('utc', now()),
      -- arm_voyage_booking_guest_shares only reaches guests who had already accepted when the
      -- amount was agreed. Someone accepting afterwards gets their own window here, so the
      -- overdue sweep can see them and the booker still gets asked to decide.
      -- Every guest who owes something for themselves gets the same two-day window, not just
      -- those on a booking that went through a negotiation. While a negotiation is still open
      -- the guest is suspended and no window is armed — arm_voyage_booking_guest_shares opens
      -- it, with its own email, the moment the amount is agreed.
      share_payment_due_at = case
        when v_request.payment_mode = 'each_pays_own'
         and not public.voyage_booking_negotiation_open(v_request.id)
          then timezone('utc', now()) + interval '2 days'
        else share_payment_due_at
      end,
      updated_at = timezone('utc', now())
  where id = _participant_id
  returning * into v_row;

  update public.voyage_booking_requests request
  set profile_id = auth.uid(),
      candidate_info = case
        when jsonb_typeof(coalesce(_candidate_info, '{}'::jsonb)) = 'object' then coalesce(_candidate_info, '{}'::jsonb)
        else request.candidate_info
      end,
      updated_at = timezone('utc', now())
  where request.id = v_row.booking_request_id
    and request.party_size = 1
    and not exists (
      select 1
      from public.voyage_booking_participants other_participant
      where other_participant.booking_request_id = request.id
        and other_participant.id <> v_row.id
    );

  return v_row;
end;
$$;


revoke execute on function public.accept_booking_participation(uuid, jsonb) from public, anon;
grant execute on function public.accept_booking_participation(uuid, jsonb) to authenticated;
