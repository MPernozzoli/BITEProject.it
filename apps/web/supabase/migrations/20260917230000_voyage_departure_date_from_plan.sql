-- La data di partenza mostrata al pubblico segue lo stesso piano usato per
-- l'arrivo (20260830011821_voyage_arrival_date_from_plan.sql), non più solo
-- la finestra digitata a mano nell'editor.
--
-- `voyages.end_date` viene già riallineato all'ultima tratta ad ogni
-- ricalcolo del piano. `voyages.start_date` no: restava fermo alla finestra
-- inserita manualmente (es. "10-13 settembre") anche dopo che l'equipaggio
-- registrava la partenza reale su una data diversa (es. il 15). La scheda
-- viaggio, l'elenco /voyages e ogni altro punto che chiama
-- `formatVoyageDateRange` continuavano quindi a mostrare la finestra vecchia
-- invece della partenza effettiva.
--
-- La regola è simmetrica a quella dell'arrivo: se il viaggio ha un piano, la
-- sua data di partenza è la finestra di partenza della prima tratta.
-- `compute_voyage_schedule`/`apply_voyage_schedule` collassano quella
-- finestra a un singolo istante non appena viene registrato un
-- `actual_departure_at`, quindi non appena l'ammiraglio preme "parti ora" (o
-- l'admin imposta la data qui, come per "Atlantic Bound!" il 15/09) la data
-- pubblica si allinea da sola, senza bisogno di aggiornare anche
-- `voyages.start_date` a mano.

-- 1. La partenza secondo il piano: la prima tratta con una finestra di partenza.
create or replace function public.voyage_plan_departure(_voyage_id uuid)
returns table (departure_date text, departure_time text, departure_flex_days integer)
language sql
stable
set search_path = public
as $$
  select
    to_char(timezone('Europe/Rome', leg.starts_at_window_start), 'YYYY-MM-DD'),
    to_char(timezone('Europe/Rome', leg.starts_at_window_start), 'HH24:MI'),
    greatest(
      0,
      (timezone('Europe/Rome', coalesce(leg.starts_at_window_end, leg.starts_at_window_start)))::date
        - (timezone('Europe/Rome', leg.starts_at_window_start))::date
    )::integer
  from public.voyage_bookable_legs leg
  where leg.voyage_id = _voyage_id
    and leg.starts_at_window_start is not null
  order by leg.sort_order asc, leg.id asc
  limit 1
$$;

comment on function public.voyage_plan_departure(uuid) is
  'Data/ora/flessibilità di partenza del viaggio secondo il piano: finestra di partenza della prima tratta, in Europe/Rome. Nessuna riga se il viaggio non ha tratte pianificate.';

grant execute on function public.voyage_plan_departure(uuid) to authenticated, anon, service_role;

-- 2. Riporta quella partenza su voyages. No-op se non c'è un piano.
create or replace function public.sync_voyage_start_date_from_plan(_voyage_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_departure record;
begin
  select * into v_departure from public.voyage_plan_departure(_voyage_id);
  if not found then
    return false;
  end if;

  update public.voyages v
  set start_date = v_departure.departure_date,
      start_time = v_departure.departure_time,
      start_date_flex_days = v_departure.departure_flex_days,
      updated_at = timezone('utc', now())
  where v.id = _voyage_id
    and (
      v.start_date is distinct from v_departure.departure_date
      or v.start_time is distinct from v_departure.departure_time
      or coalesce(v.start_date_flex_days, 0) is distinct from v_departure.departure_flex_days
    );

  return found;
end;
$$;

comment on function public.sync_voyage_start_date_from_plan(uuid) is
  'Allinea voyages.start_date/start_time/start_date_flex_days alla finestra di partenza della prima tratta. Torna false se il viaggio non ha un piano da cui dedurla.';

revoke execute on function public.sync_voyage_start_date_from_plan(uuid) from public, anon;
grant execute on function public.sync_voyage_start_date_from_plan(uuid) to authenticated, service_role;

-- 3. Stesso trigger di statement già usato per l'arrivo: ora riallinea entrambe
--    le date ad ogni ricalcolo del piano (replan admin, actual "parti ora" /
--    "arriva ora", edit a mano delle finestre).
create or replace function public.sync_voyage_end_date_after_leg_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_voyage_id uuid;
begin
  for v_voyage_id in select distinct voyage_id from changed_legs loop
    perform public.sync_voyage_end_date_from_plan(v_voyage_id);
    perform public.sync_voyage_start_date_from_plan(v_voyage_id);
  end loop;
  return null;
end;
$$;

comment on function public.sync_voyage_end_date_after_leg_change() is
  'Trigger su voyage_bookable_legs: riallinea sia voyages.start_date (prima tratta) sia voyages.end_date (ultima tratta) al piano corrente. Nome storico, ora copre entrambe le date.';

-- 4. Backfill: tutti i viaggi che un piano ce l'hanno già, "Atlantic Bound!" incluso.
do $$
declare
  v_voyage_id uuid;
begin
  for v_voyage_id in
    select distinct voyage_id from public.voyage_bookable_legs
  loop
    perform public.sync_voyage_start_date_from_plan(v_voyage_id);
  end loop;
end;
$$;
