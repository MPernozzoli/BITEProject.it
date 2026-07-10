-- Crew auto-booking: when a voyage's booking is switched on, the two fixed crew members
-- (Massimo, Sami) are automatically booked as confirmed passengers on every currently
-- existing leg. They count toward capacity like anyone else (per admin decision), they're
-- just tagged so the UI can badge them and skip the guest checklist. Default per-leg
-- capacity also moves from 2 to 4 (2 crew + 2 guest slots by default).

alter table public.voyage_booking_requests
  add column if not exists is_crew boolean not null default false;

alter table public.voyages
  alter column booking_max_guests set default 4;

-- Fixed crew roster. Hardcoded because it's two people; add a row here (and re-run for
-- existing voyages if needed) if the crew roster ever changes.
create or replace function public.voyage_crew_profile_ids()
returns uuid[]
language sql
immutable
as $$
  select array[
    'df13c528-960c-43c4-ba59-f4fdcccd5090'::uuid, -- Massimo Pernozzoli
    '73b64a23-6223-40ef-9c23-43a4064449c5'::uuid  -- Sami Amancio
  ]
$$;

create or replace function public.ensure_voyage_crew_bookings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  crew_id uuid;
  leg_ids uuid[];
  new_request_id uuid;
begin
  -- Only fires on the false -> true transition of booking_enabled.
  if new.booking_enabled is distinct from true or coalesce(old.booking_enabled, false) = true then
    return new;
  end if;

  select coalesce(array_agg(id), array[]::uuid[])
  into leg_ids
  from public.voyage_bookable_legs
  where voyage_id = new.id;

  if array_length(leg_ids, 1) is null then
    return new;
  end if;

  foreach crew_id in array public.voyage_crew_profile_ids()
  loop
    if not exists (
      select 1 from public.profiles where id = crew_id
    ) then
      continue;
    end if;

    if exists (
      select 1 from public.voyage_booking_requests
      where voyage_id = new.id
        and profile_id = crew_id
        and is_crew = true
        and status not in ('cancelled', 'rejected', 'expired')
    ) then
      continue;
    end if;

    insert into public.voyage_booking_requests (
      voyage_id, profile_id, party_size, status, is_crew, confirmed_at
    )
    values (
      new.id, crew_id, 1, 'user_confirmed', true, timezone('utc', now())
    )
    returning id into new_request_id;

    insert into public.voyage_booking_request_legs (booking_request_id, bookable_leg_id)
    select new_request_id, leg_id from unnest(leg_ids) as leg_id;
  end loop;

  return new;
end;
$$;

drop trigger if exists voyage_crew_autobooking on public.voyages;
create trigger voyage_crew_autobooking
  after update on public.voyages
  for each row
  execute function public.ensure_voyage_crew_bookings();
