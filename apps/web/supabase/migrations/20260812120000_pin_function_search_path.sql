-- Pin search_path on two SQL functions flagged by the Supabase security advisor
-- ("Function Search Path Mutable"). Neither function references any table or
-- unqualified object, so this is a hardening no-op on behavior, not a logic change.

CREATE OR REPLACE FUNCTION public.plan_change_reason_is_force_majeure(_reason text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path = public
AS $function$
  select _reason in ('weather', 'safety', 'technical_failure', 'authority_order', 'health_emergency');
$function$;

CREATE OR REPLACE FUNCTION public.voyage_booking_payment_deadline_hours(_payment_method text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path = public
AS $function$
  select case when _payment_method = 'bank_transfer' then 24 else 1 end;
$function$;
