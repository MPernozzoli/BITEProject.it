create or replace function public.get_public_voyage_leg_availability(_voyage_ids uuid[] default null)
returns table (
  id uuid,
  voyage_id uuid,
  from_waypoint_id uuid,
  to_waypoint_id uuid,
  sort_order integer,
  starts_at_window_start timestamptz,
  starts_at_window_end timestamptz,
  ends_at_window_start timestamptz,
  ends_at_window_end timestamptz,
  is_bookable boolean,
  occupied integer,
  capacity integer,
  remaining integer,
  available boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with occupied as (
    select
      link.bookable_leg_id,
      coalesce(sum(req.party_size), 0)::integer as occupied
    from public.voyage_booking_request_legs link
    join public.voyage_booking_requests req
      on req.id = link.booking_request_id
    where req.status in ('requested', 'admin_approved', 'user_confirmed')
    group by link.bookable_leg_id
  )
  select
    leg.id,
    leg.voyage_id,
    leg.from_waypoint_id,
    leg.to_waypoint_id,
    leg.sort_order,
    leg.starts_at_window_start,
    leg.starts_at_window_end,
    leg.ends_at_window_start,
    leg.ends_at_window_end,
    leg.is_bookable,
    coalesce(occupied.occupied, 0)::integer as occupied,
    greatest(1, coalesce(voyage.booking_max_guests, 1))::integer as capacity,
    greatest(greatest(1, coalesce(voyage.booking_max_guests, 1)) - coalesce(occupied.occupied, 0), 0)::integer as remaining,
    (
      leg.is_bookable
      and greatest(1, coalesce(voyage.booking_max_guests, 1)) - coalesce(occupied.occupied, 0) > 0
      and (
        coalesce(leg.starts_at_window_end, leg.starts_at_window_start, leg.ends_at_window_end, leg.ends_at_window_start) is null
        or coalesce(leg.starts_at_window_end, leg.starts_at_window_start, leg.ends_at_window_end, leg.ends_at_window_start)::date >= current_date
      )
    ) as available
  from public.voyage_bookable_legs leg
  join public.voyages voyage
    on voyage.id = leg.voyage_id
  left join occupied
    on occupied.bookable_leg_id = leg.id
  where voyage.is_published
    and voyage.booking_enabled
    and (
      coalesce(
        voyage.end_date::date,
        voyage.departure_window_end::date,
        voyage.start_date::date,
        voyage.departure_window_start::date
      ) is null
      or coalesce(
        voyage.end_date::date,
        voyage.departure_window_end::date,
        voyage.start_date::date,
        voyage.departure_window_start::date
      ) >= current_date
    )
    and (_voyage_ids is null or leg.voyage_id = any(_voyage_ids))
  order by leg.voyage_id, leg.sort_order;
$$;

revoke execute on function public.get_public_voyage_leg_availability(uuid[]) from public;
grant execute on function public.get_public_voyage_leg_availability(uuid[]) to anon, authenticated;
