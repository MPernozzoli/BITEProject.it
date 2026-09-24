-- Phone number as private profile data.
--
-- The voyage application forms now ask for a phone number (international prefix + number) and
-- it has to be prefilled on the next application. It cannot live on public.profiles: that table
-- is readable by anon and authenticated alike ("Profiles are publicly readable"), so a column
-- there would publish every traveller's number. It gets its own one-to-one table instead, readable
-- only by its owner and by admins.
--
-- The forms keep sending the number inside candidate_info (phoneCountryCode / phoneNumber), which
-- is already visible only to the applicant and to admins, so the organiser sees it next to the
-- rest of the application. A trigger copies it to the profile on every write, which covers every
-- application path (request_voyage_booking, the contribution-proposal RPC, admin edits) without
-- touching any of them.

create table if not exists public.profile_contact_details (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  phone_country_code text,
  phone_number text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profile_contact_details_phone_country_code_format
    check (phone_country_code is null or phone_country_code ~ '^\+[1-9][0-9]{0,3}$'),
  constraint profile_contact_details_phone_number_format
    check (phone_number is null or phone_number ~ '^[0-9]{4,14}$')
);

comment on table public.profile_contact_details is
  'Private contact data of a profile (phone). Kept off public.profiles because that table is publicly readable.';

alter table public.profile_contact_details enable row level security;

drop policy if exists "Users read own contact details" on public.profile_contact_details;
create policy "Users read own contact details"
  on public.profile_contact_details for select
  to authenticated
  using (profile_id = auth.uid() or public.has_role(auth.uid(), 'admin'::public.app_role));

drop policy if exists "Users insert own contact details" on public.profile_contact_details;
create policy "Users insert own contact details"
  on public.profile_contact_details for insert
  to authenticated
  with check (profile_id = auth.uid());

drop policy if exists "Users update own contact details" on public.profile_contact_details;
create policy "Users update own contact details"
  on public.profile_contact_details for update
  to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

drop policy if exists "Admins manage contact details" on public.profile_contact_details;
create policy "Admins manage contact details"
  on public.profile_contact_details for all
  to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role))
  with check (public.has_role(auth.uid(), 'admin'::public.app_role));

revoke all on public.profile_contact_details from anon;
grant select, insert, update on public.profile_contact_details to authenticated;

drop trigger if exists touch_profile_contact_details_updated_at on public.profile_contact_details;
create trigger touch_profile_contact_details_updated_at
  before update on public.profile_contact_details
  for each row execute function public.touch_updated_at();

-- candidate_info -> profile. A malformed value is skipped rather than raised: the application
-- itself must never fail because of the copy to the profile.
create or replace function public.sync_profile_phone_from_booking_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_country_code text;
  v_number text;
begin
  if new.profile_id is null or new.candidate_info is null or jsonb_typeof(new.candidate_info) <> 'object' then
    return new;
  end if;

  v_country_code := nullif(regexp_replace(coalesce(new.candidate_info ->> 'phoneCountryCode', ''), '[^0-9+]', '', 'g'), '');
  v_number := nullif(regexp_replace(coalesce(new.candidate_info ->> 'phoneNumber', ''), '[^0-9]', '', 'g'), '');

  if v_country_code is null or v_number is null
    or v_country_code !~ '^\+[1-9][0-9]{0,3}$'
    or v_number !~ '^[0-9]{4,14}$' then
    return new;
  end if;

  if not exists (select 1 from public.profiles where id = new.profile_id) then
    return new;
  end if;

  insert into public.profile_contact_details (profile_id, phone_country_code, phone_number)
  values (new.profile_id, v_country_code, v_number)
  on conflict (profile_id) do update
    set phone_country_code = excluded.phone_country_code,
        phone_number = excluded.phone_number
    where profile_contact_details.phone_country_code is distinct from excluded.phone_country_code
       or profile_contact_details.phone_number is distinct from excluded.phone_number;

  return new;
end;
$$;

revoke execute on function public.sync_profile_phone_from_booking_request() from public, anon, authenticated;

drop trigger if exists sync_profile_phone_after_booking_request_write on public.voyage_booking_requests;
create trigger sync_profile_phone_after_booking_request_write
  after insert or update of candidate_info on public.voyage_booking_requests
  for each row execute function public.sync_profile_phone_from_booking_request();
