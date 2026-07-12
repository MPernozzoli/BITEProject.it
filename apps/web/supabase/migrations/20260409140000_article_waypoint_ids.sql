-- Collegamento articolo–waypoint stabile: UUID oltre agli indici legacy (sort_order).
alter table public.logbook_articles
  add column if not exists voyage_waypoint_start_id uuid references public.voyage_waypoints (id) on delete set null,
  add column if not exists voyage_waypoint_end_id uuid references public.voyage_waypoints (id) on delete set null;
comment on column public.logbook_articles.voyage_waypoint_start_id is
  'Waypoint di inizio segmento / punto; preferito rispetto a voyage_segment_* se risolvibile.';
comment on column public.logbook_articles.voyage_waypoint_end_id is
  'Waypoint di fine segmento (uguale a start per punto); preferito rispetto a voyage_segment_* se risolvibile.';
-- Backfill: allinea gli UUID agli indici 0-based nell’ordine sort_order corrente.
-- Subquery scalari (non LATERAL in FROM): in UPDATE...FROM Postgres non consente a.voyage_id dentro LATERAL.
update public.logbook_articles a
set
  voyage_waypoint_start_id = (
    select w.id
    from public.voyage_waypoints w
    where w.voyage_id = a.voyage_id
    order by w.sort_order asc
    offset greatest(coalesce(a.voyage_segment_start, 0), 0)
    limit 1
  ),
  voyage_waypoint_end_id = (
    select w.id
    from public.voyage_waypoints w
    where w.voyage_id = a.voyage_id
    order by w.sort_order asc
    offset greatest(coalesce(a.voyage_segment_end, coalesce(a.voyage_segment_start, 0)), 0)
    limit 1
  )
where
  a.voyage_id is not null
  and (a.voyage_segment_start is not null or a.voyage_segment_end is not null);
