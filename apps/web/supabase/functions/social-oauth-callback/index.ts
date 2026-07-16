/**
 * Callback OAuth (Meta, Google YouTube, TikTok). verify_jwt = false: chiamata dal browser del provider.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SOCIAL_OAUTH_STATE_SECRET, SOCIAL_OAUTH_CALLBACK_URL,
 * SOCIAL_OAUTH_FRONTEND_URL (es. https://tuodominio.it/admin — redirect finale dopo successo/errore),
 * INSTAGRAM_APP_ID, INSTAGRAM_APP_SECRET, GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, TIKTOK_CLIENT_SECRET
 */

import { createClient } from 'npm:@supabase/supabase-js@2'
import { verifyOAuthState } from '../_shared/social-oauth-auth.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function redirect(url: string, status = 302): Response {
  return new Response(null, { status, headers: { Location: url, ...corsHeaders } })
}

function frontendBase(): string {
  return (Deno.env.get('SOCIAL_OAUTH_FRONTEND_URL') ?? 'http://localhost:5173/admin').replace(/\/$/, '')
}

function redirectResult(ok: boolean, reason?: string): Response {
  const base = frontendBase()
  const u = new URL(base)
  if (ok) {
    u.searchParams.set('social_oauth', 'success')
  } else {
    u.searchParams.set('social_oauth', 'error')
    if (reason) u.searchParams.set('reason', reason.slice(0, 400))
  }
  return redirect(u.toString())
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  if (req.method !== 'GET') {
    return redirectResult(false, 'method')
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const stateSecret = Deno.env.get('SOCIAL_OAUTH_STATE_SECRET')
  const callbackUrl = Deno.env.get('SOCIAL_OAUTH_CALLBACK_URL')

  if (!supabaseUrl || !serviceRoleKey || !stateSecret || !callbackUrl) {
    return redirectResult(false, 'server_config')
  }

  const url = new URL(req.url)
  const code = url.searchParams.get('code')?.replace(/#_$/, '')
  const state = url.searchParams.get('state')
  const oauthError = url.searchParams.get('error_description') ?? url.searchParams.get('error')

  if (oauthError) {
    return redirectResult(false, String(oauthError).slice(0, 200))
  }
  if (!code || !state) {
    return redirectResult(false, 'missing_code_or_state')
  }

  const verified = await verifyOAuthState(stateSecret, state)
  if (!verified.ok) {
    return redirectResult(false, verified.error)
  }

  const { channel_id: channelId, provider } = verified.payload
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  let refreshOrLongToken: string
  let expiresAt: string | null = null
  let scopesNote: string | null = null
  let providerAccountLabel: string | null = null

  try {
    if (provider === 'meta_instagram') {
      const appId = Deno.env.get('INSTAGRAM_APP_ID') ?? Deno.env.get('META_APP_ID')
      const appSecret = Deno.env.get('INSTAGRAM_APP_SECRET') ?? Deno.env.get('META_APP_SECRET')
      if (!appId || !appSecret) throw new Error('meta_secret_missing')

      const body = new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        grant_type: 'authorization_code',
        redirect_uri: callbackUrl,
        code,
      })
      const tr = await fetch('https://api.instagram.com/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      })
      const tj = (await tr.json()) as {
        access_token?: string
        user_id?: number | string
        error_message?: string
        error?: { message?: string } | string
      }
      if (!tr.ok || !tj.access_token) {
        const metaError = typeof tj.error === 'string' ? tj.error : tj.error?.message
        throw new Error(tj.error_message ?? metaError ?? 'instagram_token_exchange_failed')
      }

      const llUrl = new URL('https://graph.instagram.com/access_token')
      llUrl.searchParams.set('grant_type', 'ig_exchange_token')
      llUrl.searchParams.set('client_secret', appSecret)
      llUrl.searchParams.set('access_token', tj.access_token)

      const lr = await fetch(llUrl.toString())
      const lj = (await lr.json()) as { access_token?: string; expires_in?: number; error?: { message?: string } }
      if (!lr.ok || !lj.access_token) {
        refreshOrLongToken = tj.access_token
        if (typeof tj.expires_in === 'number') {
          expiresAt = new Date(Date.now() + tj.expires_in * 1000).toISOString()
        }
      } else {
        refreshOrLongToken = lj.access_token
        if (typeof lj.expires_in === 'number') {
          expiresAt = new Date(Date.now() + lj.expires_in * 1000).toISOString()
        }
      }
      scopesNote = `instagram_business_basic,instagram_business_content_publish${
        tj.user_id ? `; instagram_user_id=${tj.user_id}` : ''
      }`
      providerAccountLabel = tj.user_id ? `Instagram ${tj.user_id}` : null
    } else if (provider === 'google_youtube') {
      const clientId = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID')
      const clientSecret = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET')
      if (!clientId || !clientSecret) throw new Error('google_secret_missing')

      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: callbackUrl,
        client_id: clientId,
        client_secret: clientSecret,
      })
      const tr = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      })
      const tj = (await tr.json()) as {
        access_token?: string
        refresh_token?: string
        expires_in?: number
        error?: string
      }
      if (!tr.ok) {
        throw new Error(tj.error ?? 'google_token_exchange_failed')
      }
      refreshOrLongToken = tj.refresh_token ?? tj.access_token ?? ''
      if (!refreshOrLongToken) throw new Error('google_no_token')
      if (typeof tj.expires_in === 'number') {
        expiresAt = new Date(Date.now() + tj.expires_in * 1000).toISOString()
      }
      scopesNote = 'youtube'
    } else if (provider === 'tiktok') {
      const clientKey = Deno.env.get('TIKTOK_CLIENT_KEY')
      const clientSecret = Deno.env.get('TIKTOK_CLIENT_SECRET')
      if (!clientKey || !clientSecret) throw new Error('tiktok_secret_missing')

      const body = new URLSearchParams({
        client_key: clientKey,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: callbackUrl,
      })
      const tr = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      })
      const tj = (await tr.json()) as {
        access_token?: string
        refresh_token?: string
        expires_in?: number
        error?: string
        message?: string
      }
      if (!tr.ok) {
        throw new Error(tj.message ?? tj.error ?? 'tiktok_token_exchange_failed')
      }
      refreshOrLongToken = tj.refresh_token ?? tj.access_token ?? ''
      if (!refreshOrLongToken) throw new Error('tiktok_no_token')
      if (typeof tj.expires_in === 'number') {
        expiresAt = new Date(Date.now() + tj.expires_in * 1000).toISOString()
      }
      scopesNote = 'tiktok'
    } else {
      return redirectResult(false, 'unknown_provider')
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'exchange_failed'
    console.error('social-oauth-callback', msg)
    return redirectResult(false, msg)
  }

  const { data: existing } = await supabase
    .from('social_oauth_connections')
    .select('id, account_label')
    .eq('channel_id', channelId)
    .maybeSingle()

  const now = new Date().toISOString()
  const { error: upErr } = await supabase.from('social_oauth_connections').upsert(
    {
      ...(existing?.id ? { id: existing.id } : {}),
      channel_id: channelId,
      provider,
      account_label: existing?.account_label ?? providerAccountLabel,
      refresh_token_encrypted: refreshOrLongToken,
      access_token_expires_at: expiresAt,
      scopes: scopesNote,
      updated_at: now,
    },
    { onConflict: 'channel_id' },
  )

  if (upErr) {
    console.error('social_oauth_connections upsert', upErr)
    return redirectResult(false, upErr.message)
  }

  return redirectResult(true)
})
