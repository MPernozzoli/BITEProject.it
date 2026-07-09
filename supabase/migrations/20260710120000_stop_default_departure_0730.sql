-- Standardize the default "nights" stop departure to 07:30 the morning after arrival
-- (was 07:00). This is only a safety fallback for the rare case _stop_departure_time is
-- null on a 'nights'-mode waypoint; the admin UI always sets an explicit value (07:30,
-- or 19:00 for a stop preceding an open-sea leg, which is typically sailed overnight).
create or replace function public.booking_next_departure(
  _arrival timestamptz,
  _stop_mode text,
  _stop_hours integer,
  _stop_nights integer,
  _stop_departure_time time,
  _legacy_minutes integer
)
returns timestamptz
language plpgsql
stable
set search_path = public
as $$
declare
  d timestamptz;
begin
  if _arrival is null then
    return null;
  end if;

  if _stop_mode = 'hours' then
    return _arrival + make_interval(hours => greatest(coalesce(_stop_hours, 0), 0));
  elsif _stop_mode = 'nights' then
    d := (
      ((timezone('Europe/Rome', _arrival))::date + greatest(coalesce(_stop_nights, 1), 0))
      + coalesce(_stop_departure_time, '07:30'::time)
    ) at time zone 'Europe/Rome';
    if d < _arrival then
      d := d + interval '1 day';
    end if;
    return d;
  else
    return _arrival + make_interval(mins => greatest(coalesce(_legacy_minutes, 0), 0));
  end if;
end;
$$;

grant execute on function public.booking_next_departure(timestamptz, text, integer, integer, time, integer) to authenticated;
