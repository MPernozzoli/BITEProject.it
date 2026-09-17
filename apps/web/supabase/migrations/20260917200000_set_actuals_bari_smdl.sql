-- Set actual departure from Bari and actual arrival/departure at Santa Maria di Leuca
-- for voyage "Atlantic Bound!" (c421e207-86d0-42e9-be1c-6b7abb3e6c89)
-- Bari → SMdL: partenza 15/09/2026 13:00 (Europe/Rome), arrivo 16/09/2026 22:00 (Europe/Rome)
-- SMdL: arrivo e partenza coincidono (nessuna sosta)

UPDATE voyage_waypoints
SET actual_departure_at = '2026-09-15T11:00:00Z'
WHERE voyage_id = 'c421e207-86d0-42e9-be1c-6b7abb3e6c89'
  AND name = 'Bari'
  AND sort_order = 0;

UPDATE voyage_waypoints
SET actual_arrival_at   = '2026-09-16T20:00:00Z',
    actual_departure_at = '2026-09-16T20:00:00Z'
WHERE voyage_id = 'c421e207-86d0-42e9-be1c-6b7abb3e6c89'
  AND name = 'Santa Maria di Leuca'
  AND sort_order = 11;
