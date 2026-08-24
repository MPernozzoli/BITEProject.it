/**
 * Avvio OAuth per canali editoriali social (admin).
 *
 * Env:
 * - SOCIAL_OAUTH_STATE_SECRET (obbligatorio)
 * - SOCIAL_OAUTH_CALLBACK_URL: stesso URL su Meta / Google / TikTok (…/functions/v1/social-oauth-callback)
 * - INSTAGRAM_APP_ID, INSTAGRAM_APP_SECRET · GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET · TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET
 *
 * GET ?channel_id=<uuid>  (Authorization: Bearer <access_token utente admin>, header apikey anon)
 */

import { createClient } from 'npm:@supabase/supabase-js@2'
import { requireAdmin, signOAuthState } from '../_shared/social-oauth-auth.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function providerForChannelCode(code: string): string | null {
  if (code === 'youtube') return 'google_youtube'
  if (code === 'tiktok') return 'tiktok'
  if (code === 'instagram_bite' || code === 'instagram_dogs') return 'meta_instagram'
  return null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  if (req.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const stateSecret = Deno.env.get('SOCIAL_OAUTH_STATE_SECRET')

  if (!supabaseUrl || !serviceRoleKey || !stateSecret) {
    return json({ error: 'Server misconfigured (SUPABASE_URL, SERVICE_ROLE, SOCIAL_OAUTH_STATE_SECRET)' }, 500)
  }

  const admin = await requireAdmin(req, supabaseUrl, serviceRoleKey)
  if (!admin.ok) return admin.response

  const url = new URL(req.url)
  const channelId = url.searchParams.get('channel_id')?.trim()
  if (!channelId) {
    return json({ error: 'channel_id required' }, 400)
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)
  const { data: channel, error: chErr } = await supabase
    .from('editorial_plan_channels')
    .select('id, code')
    .eq('id', channelId)
    .maybeSingle()

  if (chErr || !channel) {
    return json({ error: 'Channel not found' }, 404)
  }

  if (channel.code === 'site') {
    return json({ error: 'OAuth not applicable to site channel' }, 400)
  }

  const provider = providerForChannelCode(channel.code as string)
  if (!provider) {
    return json({ error: 'Unknown channel' }, 400)
  }

  const exp = Math.floor(Date.now() / 1000) + 600
  const state = await signOAuthState(stateSecret, {
    channel_id: channelId,
    provider,
    exp,
  })

  const callbackUrl = Deno.env.get('SOCIAL_OAUTH_CALLBACK_URL')

  if (provider === 'meta_instagram') {
    const appId = Deno.env.get('INSTAGRAM_APP_ID') ?? Deno.env.get('META_APP_ID')
    if (!appId || !callbackUrl) {
      return json(
        {
          error: 'meta_not_configured',
          hint:
            'Imposta INSTAGRAM_APP_ID e SOCIAL_OAUTH_CALLBACK_URL (URL function social-oauth-callback) nel progetto Supabase. INSTAGRAM_APP_ID è l’ID in Instagram > API setup with Instagram login nel portale Meta.',
        },
        503,
      )
    }
    const redirect = callbackUrl
    const scopes = [
      'instagram_business_basic',
      'instagram_business_content_publish',
      'instagram_business_manage_insights',
      'instagram_business_manage_comments',
    ].join(',')
    const auth = new URL('https://www.instagram.com/oauth/authorize')
    auth.searchParams.set('client_id', appId)
    auth.searchParams.set('redirect_uri', redirect)
    auth.searchParams.set('state', state)
    auth.searchParams.set('response_type', 'code')
    auth.searchParams.set('scope', scopes)
    auth.searchParams.set('enable_fb_login', '0')
    auth.searchParams.set('force_authentication', '1')
    return json({ authorization_url: auth.toString(), provider })
  }

  if (provider === 'google_youtube') {
    const clientId = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID')
    if (!clientId || !callbackUrl) {
      return json(
        {
          error: 'google_not_configured',
          hint: 'Imposta GOOGLE_OAUTH_CLIENT_ID e SOCIAL_OAUTH_CALLBACK_URL.',
        },
        503,
      )
    }
    const redirect = callbackUrl
    const scopes = [
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube.readonly',
    ].join(' ')
    const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    auth.searchParams.set('client_id', clientId)
    auth.searchParams.set('redirect_uri', redirect)
    auth.searchParams.set('response_type', 'code')
    auth.searchParams.set('scope', scopes)
    auth.searchParams.set('state', state)
    auth.searchParams.set('access_type', 'offline')
    auth.searchParams.set('prompt', 'consent')
    return json({ authorization_url: auth.toString(), provider })
  }

  if (provider === 'tiktok') {
    const clientKey = Deno.env.get('TIKTOK_CLIENT_KEY')
    if (!clientKey || !callbackUrl) {
      return json(
        {
          error: 'tiktok_not_configured',
          hint: 'Imposta TIKTOK_CLIENT_KEY e SOCIAL_OAUTH_CALLBACK_URL.',
        },
        503,
      )
    }
    const redirect = callbackUrl
    const scopes = 'user.info.basic,video.upload'
    const auth = new URL('https://www.tiktok.com/v2/auth/authorize/')
    auth.searchParams.set('client_key', clientKey)
    auth.searchParams.set('redirect_uri', redirect)
    auth.searchParams.set('scope', scopes)
    auth.searchParams.set('state', state)
    auth.searchParams.set('response_type', 'code')
    return json({ authorization_url: auth.toString(), provider })
  }

  return json({ error: 'Unsupported provider' }, 400)
})
