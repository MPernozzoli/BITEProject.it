-- Multi-person applications are created 'pending_payment' and immediately send the lead to
-- /bookings/:id/participants to name their guests and pick who pays. set_booking_participants
-- rejected any status outside the old active set, so that first save raised 'booking_not_active'
-- and the whole multi-person flow dead-ended at the payment gate introduced in 20260721140100.
--
-- Naming guests is exactly what has to happen *before* paying (the payer and the amount depend
-- on the party and the payment mode), so 'pending_payment' belongs in this list.

create or replace function public.set_booking_participants(
  _booking_request_id uuid,
  _payment_mode text,
  _participants jsonb
)
returns setof public.voyage_booking_participants
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.voyage_booking_requests%rowtype;
  v_lead_email text;
  v_expected_guests integer;
  v_guest jsonb;
  v_guest_count integer := 0;
begin
  select * into v_request
  from public.voyage_booking_requests
  where id = _booking_request_id;

  if not found then
    raise exception 'booking_not_found';
  end if;
  if v_request.profile_id <> auth.uid() then
    raise exception 'not_booking_owner';
  end if;
  if v_request.status not in ('pending_payment', 'requested', 'waitlisted', 'admin_approved', 'user_confirmed') then
    raise exception 'booking_not_active';
  end if;
  if _payment_mode not in ('lead_pays_all', 'each_pays_own') then
    raise exception 'invalid_payment_mode';
  end if;

  v_expected_guests := greatest(0, v_request.party_size - 1);
  if jsonb_typeof(_participants) <> 'array' then
    raise exception 'participants_not_array';
  end if;
  if jsonb_array_length(_participants) <> v_expected_guests then
    raise exception 'participant_count_mismatch';
  end if;

  update public.voyage_booking_requests
  set payment_mode = _payment_mode, updated_at = timezone('utc', now())
  where id = _booking_request_id;

  -- Lead participant (the booker) — already accepted the conditions at booking time.
  select email into v_lead_email from public.profiles where id = auth.uid();
  insert into public.voyage_booking_participants (
    booking_request_id, profile_id, email, is_lead, status, conditions_accepted_at, accepted_at
  )
  values (
    _booking_request_id, auth.uid(), coalesce(v_lead_email, ''), true, 'accepted',
    timezone('utc', now()), timezone('utc', now())
  )
  on conflict (booking_request_id, lower(email)) do update
  set is_lead = true, profile_id = auth.uid(), status = 'accepted', updated_at = timezone('utc', now());

  -- Replace the guest set: drop previous non-lead rows, re-insert from the payload.
  delete from public.voyage_booking_participants
  where booking_request_id = _booking_request_id and is_lead = false;

  for v_guest in select * from jsonb_array_elements(_participants)
  loop
    v_guest_count := v_guest_count + 1;
    insert into public.voyage_booking_participants (
      booking_request_id, profile_id, email, first_name, last_name, status, expires_at
    )
    values (
      _booking_request_id,
      (select id from public.profiles where lower(email) = lower(v_guest ->> 'email') limit 1),
      lower(trim(v_guest ->> 'email')),
      nullif(trim(v_guest ->> 'first_name'), ''),
      nullif(trim(v_guest ->> 'last_name'), ''),
      'pending',
      timezone('utc', now()) + interval '7 days'
    );
  end loop;

  -- Admins are told about the guest list only once the application actually exists for them,
  -- i.e. not while it is still sitting behind the payment gate.
  if v_request.status <> 'pending_payment' then
    perform public.enqueue_admin_voyage_booking_notifications(
      _booking_request_id,
      'admin_modified',
      jsonb_build_object('guest_count', v_guest_count, 'payment_mode', _payment_mode)
    );
  end if;

  return query
    select * from public.voyage_booking_participants
    where booking_request_id = _booking_request_id
    order by is_lead desc, created_at asc;
end;
$$;

revoke execute on function public.set_booking_participants(uuid, text, jsonb) from public, anon;
grant execute on function public.set_booking_participants(uuid, text, jsonb) to authenticated;
