-- Short "hours" stops must depart after arrival on the same local day.
-- Overnight departures should use stop_mode = 'nights' instead.
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
    if _stop_departure_time is not null then
      d := (
        (timezone('Europe/Rome', _arrival))::date + _stop_departure_time
      ) at time zone 'Europe/Rome';
      if d <= _arrival then
        raise exception 'stop_departure_time must be after arrival for hours stops'
          using errcode = '22007';
      end if;
      return d;
    end if;
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
