-- La data di arrivo di un viaggio la decide il piano, non più la mano dell'admin.
--
-- `voyages.end_date` nasceva come campo manuale dell'editor di rotta: si digitava
-- una data, oppure si accettava la stima "distanza / velocità" calcolata sul
-- tracciato completo (tutti i waypoint, tecnici compresi). Da allora il piano è
-- diventato la fonte reale del calendario: `sync_voyage_bookable_legs_plan` e
-- `compute_voyage_schedule` derivano le finestre di ogni tratta dai soli waypoint
-- pubblici, con le soste configurate e gli actual registrati dall'equipaggio.
--
-- I due numeri hanno smesso di coincidere e nessuno riallineava il primo. Su
-- "Atlantic Bound!" il piano arrivava a Lisbona il 28-31 ottobre 2026 mentre
-- `end_date` era ferma al 15 ottobre: la data sbagliata compariva ovunque —
-- scheda viaggio, legend, prerender/SEO, widget live, elenchi booking — e in più
-- `deriveWaypointDateSuggestions` la usava come tetto per clampare le date
-- suggerite delle tappe intermedie, propagando il 15 ottobre a mezzo itinerario.
--
-- La regola che questa migrazione installa: se il viaggio ha un piano, la sua
-- data di arrivo è la finestra di arrivo dell'ultima tratta. `end_date` /
-- `end_time` sono l'inizio di quella finestra in Europe/Rome, `end_date_flex_days`
-- la sua ampiezza in giorni. Un viaggio senza tratte (booking spento, viaggi
-- storici) resta con le sue date inserite a mano: lì non c'è un piano da cui
-- dedurre nulla.
--
-- Il riallineamento passa da un trigger di statement su `voyage_bookable_legs`,
-- non da una chiamata dentro `apply_voyage_schedule`, perché le finestre delle
-- tratte si scrivono da più punti: il ricalcolo del piano, gli actual
-- ("parti ora" / "arriva ora") e la modifica a mano delle finestre nel pannello
-- Rotte dell'admin, che salva le tratte senza passare da alcun ricalcolo.

-- 1. L'arrivo secondo il piano: l'ultima tratta che abbia una finestra di arrivo.
create or replace function public.voyage_plan_arrival(_voyage_id uuid)
returns table (arrival_date text, arrival_time text, arrival_flex_days integer)
language sql
stable
set search_path = public
as $$
  select
    to_char(timezone('Europe/Rome', leg.ends_at_window_start), 'YYYY-MM-DD'),
    to_char(timezone('Europe/Rome', leg.ends_at_window_start), 'HH24:MI'),
    greatest(
      0,
      (timezone('Europe/Rome', coalesce(leg.ends_at_window_end, leg.ends_at_window_start)))::date
        - (timezone('Europe/Rome', leg.ends_at_window_start))::date
    )::integer
  from public.voyage_bookable_legs leg
  where leg.voyage_id = _voyage_id
    and leg.ends_at_window_start is not null
  order by leg.sort_order desc, leg.id desc
  limit 1
$$;

comment on function public.voyage_plan_arrival(uuid) is
  'Data/ora/flessibilità di arrivo del viaggio secondo il piano: finestra di arrivo dell''ultima tratta, in Europe/Rome. Nessuna riga se il viaggio non ha tratte pianificate.';

grant execute on function public.voyage_plan_arrival(uuid) to authenticated, anon, service_role;

-- 2. Riporta quell'arrivo su voyages. No-op se non c'è un piano.
create or replace function public.sync_voyage_end_date_from_plan(_voyage_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_arrival record;
begin
  select * into v_arrival from public.voyage_plan_arrival(_voyage_id);
  if not found then
    return false;
  end if;

  update public.voyages v
  set end_date = v_arrival.arrival_date,
      end_time = v_arrival.arrival_time,
      end_date_flex_days = v_arrival.arrival_flex_days,
      updated_at = timezone('utc', now())
  where v.id = _voyage_id
    and (
      v.end_date is distinct from v_arrival.arrival_date
      or v.end_time is distinct from v_arrival.arrival_time
      or coalesce(v.end_date_flex_days, 0) is distinct from v_arrival.arrival_flex_days
    );

  return found;
end;
$$;

comment on function public.sync_voyage_end_date_from_plan(uuid) is
  'Allinea voyages.end_date/end_time/end_date_flex_days alla finestra di arrivo dell''ultima tratta. Torna false se il viaggio non ha un piano da cui dedurla.';

revoke execute on function public.sync_voyage_end_date_from_plan(uuid) from public, anon;
grant execute on function public.sync_voyage_end_date_from_plan(uuid) to authenticated, service_role;

-- 3. Il trigger. Di statement, con transition table: un ricalcolo del piano tocca
--    tutte le tratte in un solo UPDATE e qui produce una sola sincronizzazione.
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
  end loop;
  return null;
end;
$$;

drop trigger if exists sync_voyage_end_date_after_leg_insert on public.voyage_bookable_legs;
drop trigger if exists sync_voyage_end_date_after_leg_update on public.voyage_bookable_legs;
drop trigger if exists sync_voyage_end_date_after_leg_delete on public.voyage_bookable_legs;

create trigger sync_voyage_end_date_after_leg_insert
after insert on public.voyage_bookable_legs
referencing new table as changed_legs
for each statement execute function public.sync_voyage_end_date_after_leg_change();

create trigger sync_voyage_end_date_after_leg_update
after update on public.voyage_bookable_legs
referencing new table as changed_legs
for each statement execute function public.sync_voyage_end_date_after_leg_change();

-- Sulla DELETE la tratta cancellata può essere proprio l'ultima: senza questo
-- trigger l'arrivo resterebbe quello di una tappa che non esiste più.
create trigger sync_voyage_end_date_after_leg_delete
after delete on public.voyage_bookable_legs
referencing old table as changed_legs
for each statement execute function public.sync_voyage_end_date_after_leg_change();

-- 4. Backfill: tutti i viaggi che un piano ce l'hanno già.
do $$
declare
  v_voyage_id uuid;
begin
  for v_voyage_id in
    select distinct voyage_id from public.voyage_bookable_legs
  loop
    perform public.sync_voyage_end_date_from_plan(v_voyage_id);
  end loop;
end;
$$;
