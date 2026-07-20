// Shared authorization for internal service-to-service Edge Function calls.
//
// Historically each function decoded the incoming Bearer token as a JWT and
// required `role === 'service_role'`. That breaks when the project uses the new
// Supabase API key format (`sb_secret_...`), which is an opaque key, not a JWT:
// callers forward the injected `SUPABASE_SERVICE_ROLE_KEY` verbatim, the callee
// fails to parse a role, and returns 403.
//
// `isInjectedServiceKey` closes that gap: it accepts the token when it matches
// the function's own injected `SUPABASE_SERVICE_ROLE_KEY` (any key format),
// using a length-safe constant-time comparison. Keep the existing JWT-role check
// alongside it so external service_role JWT callers keep working.

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}

/**
 * True when `token` equals this function's injected SUPABASE_SERVICE_ROLE_KEY.
 * Works regardless of key format (legacy JWT or new `sb_secret_...`), because
 * both caller and callee read the same injected value.
 */
export function isInjectedServiceKey(token: string): boolean {
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  return key.length > 0 && timingSafeEqual(token, key)
}
