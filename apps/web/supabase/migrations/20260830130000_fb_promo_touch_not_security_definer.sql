-- `touch_fb_promo_updated_at` non ha motivo di essere SECURITY DEFINER.
--
-- Scrivere `updated_at` sulla riga che si sta già aggiornando non richiede
-- privilegi elevati: chi non può fare l'UPDATE non arriva mai al trigger. Con
-- SECURITY DEFINER la funzione risultava però esposta come RPC eseguibile da
-- `anon` (lint 0028), cioè una funzione privilegiata raggiungibile senza
-- sessione — innocua qui, perché fuori da un trigger fallisce, ma è comunque
-- superficie che non serve a nessuno.

create or replace function public.touch_fb_promo_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

revoke all on function public.touch_fb_promo_updated_at() from public, anon, authenticated;
