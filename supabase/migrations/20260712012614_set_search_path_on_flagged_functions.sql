-- Make search_path explicit on functions flagged by Supabase security advisors.

alter function public._migration_exec(text)
  set search_path = public, pg_temp;

alter function public.touch_updated_at()
  set search_path = public, pg_temp;

alter function public.voyage_crew_profile_ids()
  set search_path = public, pg_temp;
