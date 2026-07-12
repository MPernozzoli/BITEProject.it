-- Ensure candidate_info has the same shape even when a previous migration
-- already created the column before NOT NULL/default were introduced.

update public.voyage_booking_requests
set candidate_info = '{}'::jsonb
where candidate_info is null;

alter table public.voyage_booking_requests
  alter column candidate_info set default '{}'::jsonb,
  alter column candidate_info set not null;

update public.voyage_booking_participants
set candidate_info = '{}'::jsonb
where candidate_info is null;

alter table public.voyage_booking_participants
  alter column candidate_info set default '{}'::jsonb,
  alter column candidate_info set not null;
