-- Every profile in the database says Italian, and not one of them ever chose it.
--
-- profiles.preferred_language is NOT NULL DEFAULT 'it', and no profile-creation path sets it:
-- profiles are created lazily by security-definer functions (request_voyage_booking,
-- admin_create_voyage_booking_invite_by_email, …) that insert only id/email/name. So the default
-- won every time, and every transactional email went out in Italian regardless of who read it.
--
-- The signup form already collects the language — UserLogin.tsx passes { name, lang } as signUp
-- metadata, and auth-email-hook reads it back for auth emails — but nothing ever copied it onto
-- the profile, so every other email (booking, briefing, availability) never saw it.
--
-- A BEFORE INSERT trigger on profiles is the single point that covers every creation path at
-- once, present and future, without having to find and edit each lazy insert.

create or replace function public.seed_profile_language_from_signup()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_signup_lang text;
begin
  -- Only fills in what nobody chose. The column is NOT NULL DEFAULT 'it', so a row arriving with
  -- 'it' cannot be told apart from one that simply defaulted — which is harmless here: no
  -- creation path lets a user pick a language at insert time, so 'it' always means "unset", and
  -- when the signup metadata also says Italian the outcome is identical either way.
  if new.preferred_language is not null and new.preferred_language <> 'it' then
    return new;
  end if;

  select nullif(trim(u.raw_user_meta_data ->> 'lang'), '')
  into v_signup_lang
  from auth.users u
  where u.id = new.id;

  if v_signup_lang is not null then
    -- Store the bare code: 'en-GB' and 'en' must not be two different languages downstream.
    new.preferred_language := lower(split_part(replace(v_signup_lang, '_', '-'), '-', 1));
  end if;

  return new;
end;
$$;

drop trigger if exists seed_profile_language_from_signup on public.profiles;
create trigger seed_profile_language_from_signup
before insert on public.profiles
for each row
execute function public.seed_profile_language_from_signup();

-- No backfill for existing rows: raw_user_meta_data->>'lang' is null for every user created so
-- far (the metadata predates none of them — it was simply never populated for these accounts),
-- so there is nothing to recover. Those profiles keep whatever they have until their owner
-- changes it, and resolveSiteLanguage in the Edge Functions decides the rest.
