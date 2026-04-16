/**
 * Worker stub: elaborerà `editorial_publish_targets` in stato pending alla data/ora prevista,
 * con raggruppamento opzionale per `syndication_batch_id` e idempotenza per target.
 *
 * Fasi successive: OAuth Meta/YouTube/TikTok, upload da Storage, retry.
 * (Opzionale) Pipeline AI: generazione bozza testi → revisione umana → ready.
 *
 * Schedulazione consigliata: POST periodico con service role (come publish-scheduled-articles).
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-cron-secret',
}

function jsonResponse(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function authorizeCron(req: Request): boolean {
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const cronSecret = Deno.env.get('SOCIAL_PUBLISH_CRON_SECRET')

  const authHeader = req.headers.get('Authorization')
  const bearer =
    authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : ''

  if (serviceRoleKey && bearer === serviceRoleKey) {
    return true
  }

  if (cronSecret) {
    const headerSecret = req.headers.get('x-cron-secret')
    return Boolean(headerSecret && headerSecret === cronSecret)
  }

  return false
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  if (!authorizeCron(req)) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  return jsonResponse({
    ok: true,
    processed: 0,
    message: 'publish-social-queue stub: nessuna pubblicazione eseguita.',
  })
})
