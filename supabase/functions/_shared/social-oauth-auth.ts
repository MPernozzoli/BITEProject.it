import { createClient } from 'npm:@supabase/supabase-js@2'

const textEncoder = new TextEncoder()

export type JwtClaims = Record<string, unknown> | null

export function parseJwtClaims(token: string): JwtClaims {
  const parts = token.split('.')
  if (parts.length < 2) return null
  try {
    const payload = parts[1].replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(parts[1].length / 4) * 4, '=')
    return JSON.parse(atob(payload)) as Record<string, unknown>
  } catch {
    return null
  }
}

/** Verifica JWT utente (o service role) e ruolo admin via RPC `has_role`. */
export async function requireAdmin(
  req: Request,
  supabaseUrl: string,
  serviceRoleKey: string,
): Promise<{ ok: true; userId: string } | { ok: false; response: Response }> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return { ok: false, response: jsonErr('Unauthorized', 401) }
  }

  const token = authHeader.slice('Bearer '.length).trim()
  const claims = parseJwtClaims(token)

  if (claims?.role === 'service_role') {
    return { ok: true, userId: 'service_role' }
  }

  const userId = typeof claims?.sub === 'string' ? claims.sub : null
  if (!userId) {
    return { ok: false, response: jsonErr('Unauthorized', 401) }
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)
  const { data: isAdmin, error } = await supabase.rpc('has_role', {
    _user_id: userId,
    _role: 'admin',
  })

  if (error || !isAdmin) {
    return { ok: false, response: jsonErr('Forbidden', 403) }
  }

  return { ok: true, userId }
}

export function jsonErr(message: string, status: number, extra?: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ error: message, ...extra }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  })
}

export function jsonOk(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  })
}

export type OAuthStatePayload = {
  channel_id: string
  provider: string
  exp: number
}

function b64url(data: string): string {
  return btoa(data).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function b64urlDecode(s: string): string {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  return atob(s.replaceAll('-', '+').replaceAll('_', '/') + pad)
}

export async function signOAuthState(secret: string, payload: OAuthStatePayload): Promise<string> {
  const body = JSON.stringify(payload)
  const bodyB64 = b64url(body)
  const sig = await hmacSha256B64url(secret, bodyB64)
  return `${bodyB64}.${sig}`
}

export async function verifyOAuthState(
  secret: string,
  state: string,
): Promise<{ ok: true; payload: OAuthStatePayload } | { ok: false; error: string }> {
  const parts = state.split('.')
  if (parts.length !== 2) return { ok: false, error: 'invalid_state' }
  const [bodyB64, sig] = parts
  const expected = await hmacSha256B64url(secret, bodyB64)
  if (expected !== sig) return { ok: false, error: 'bad_signature' }
  try {
    const payload = JSON.parse(b64urlDecode(bodyB64)) as OAuthStatePayload
    if (!payload.channel_id || !payload.provider || typeof payload.exp !== 'number') {
      return { ok: false, error: 'bad_payload' }
    }
    if (payload.exp < Date.now() / 1000) return { ok: false, error: 'expired' }
    return { ok: true, payload }
  } catch {
    return { ok: false, error: 'parse' }
  }
}

async function hmacSha256B64url(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, textEncoder.encode(message))
  const bytes = new Uint8Array(sig)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!)
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}
