-- voyage_leg_booking_conflict_exists must not be callable from the client.
--
-- It shipped in 20260817120000 with `grant execute ... to authenticated`, copied from the
-- convention used by the RPCs around it. Those are entry points; this one is not. Every caller
-- (request_voyage_booking, reactivate_expired_voyage_booking, set_booking_participants) is
-- itself SECURITY DEFINER, so it runs the helper with the function owner's privileges and never
-- needs the grant.
--
-- Left in place, the grant published /rest/v1/rpc/voyage_leg_booking_conflict_exists to every
-- signed-in user: an email-membership oracle ("is this address aboard this leg?") over data the
-- participants RLS policies deliberately keep private to the lead and the guest themselves.

revoke execute on function public.voyage_leg_booking_conflict_exists(uuid[], uuid, text, uuid)
  from public, anon, authenticated;

comment on function public.voyage_leg_booking_conflict_exists(uuid[], uuid, text, uuid) is
  'Whether a person (by profile and/or email) already holds an active place on any of these legs — as the booker of a request or as a pending/accepted guest on someone else''s. Internal helper: called only from SECURITY DEFINER RPCs, never granted to client roles.';
