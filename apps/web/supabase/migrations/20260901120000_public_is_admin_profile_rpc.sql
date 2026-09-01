-- RPC pubblica per sapere se un profilo è admin, senza esporre `user_roles`.
--
-- La sitemap dinamica e la pagina profilo indicizzabile devono decidere se
-- indicizzare un profilo in base al ruolo — solo gli admin, non gli utenti
-- normali (privacy: bio, social e "membro da" di chi si è solo iscritto per
-- prenotare o commentare non deve finire su Google). `user_roles` non è (e non
-- deve essere) leggibile da `anon`, quindi né `/api/prerender` (chiave
-- pubblicabile) né il client possono fare quel controllo direttamente.
--
-- `has_role` esiste già ma non è concesso ad `anon`/`authenticated` (verificato:
-- 401 "permission denied for function has_role") — resta riservato all'uso
-- interno nelle policy RLS. Questa funzione è un wrapper a superficie minima:
-- risponde solo "true/false per QUESTO profilo", non espone l'elenco admin.

create or replace function public.is_admin_profile(profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role(profile_id, 'admin'::public.app_role);
$$;

revoke all on function public.is_admin_profile(uuid) from public;
grant execute on function public.is_admin_profile(uuid) to anon, authenticated;
