import { createClient } from 'npm:@supabase/supabase-js@2'

/**
 * Pubblica articoli con status "scheduled" la cui scheduled_at è nel passato o uguale a ora.
 *
 * Schedulazione consigliata (Supabase Dashboard → Edge Functions → Schedules, oppure cron esterno):
 * POST ogni minuto a /functions/v1/publish-scheduled-articles
 * Header: Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
 * opzionale: x-cron-secret: <SCHEDULED_ARTICLES_CRON_SECRET> se imposti il secret nel progetto.
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
  const cronSecret = Deno.env.get('SCHEDULED_ARTICLES_CRON_SECRET')

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

function isDryRun(req: Request): boolean {
  const url = new URL(req.url)
  return url.searchParams.get('dry_run') === '1' || url.searchParams.get('dryRun') === 'true'
}

function runInBackground(task: Promise<unknown>, label: string): void {
  const guardedTask = task.catch((error) => {
    console.error(label, error)
  })
  const runtime = (globalThis as {
    EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void }
  }).EdgeRuntime

  if (runtime?.waitUntil) {
    runtime.waitUntil(guardedTask)
    return
  }

  void guardedTask
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

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Server configuration error' }, 500)
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)
  const nowIso = new Date().toISOString()
  const dryRun = isDryRun(req)

  const { data: due, error: selErr } = await supabase
    .from('logbook_articles')
    .select('id, slug, story_id, scheduled_at')
    .eq('status', 'scheduled')
    .not('scheduled_at', 'is', null)
    .lte('scheduled_at', nowIso)
    .order('scheduled_at', { ascending: true })
    .limit(100)

  if (selErr) {
    console.error('publish-scheduled-articles select', selErr)
    return jsonResponse({ error: 'Query failed' }, 500)
  }

  const publishedIds: string[] = []
  const errors: Array<{ id: string; message: string }> = []

  if (dryRun) {
    return jsonResponse({
      success: true,
      dryRun,
      dueCount: due?.length ?? 0,
      dueIds: (due ?? []).map((row) => row.id),
      errors,
    })
  }

  for (const row of due ?? []) {
    const scheduledAt = row.scheduled_at as string | null
    if (!scheduledAt) continue

    const { data: updated, error: upErr } = await supabase
      .from('logbook_articles')
      .update({
        status: 'published',
        published_at: scheduledAt,
        scheduled_at: null,
      })
      .eq('id', row.id)
      .eq('status', 'scheduled')
      .select('id')
      .maybeSingle()

    if (upErr) {
      errors.push({ id: row.id, message: upErr.message })
      continue
    }

    if (!updated) {
      continue
    }

    publishedIds.push(row.id)

    runInBackground((async () => {
      const seoResponse = await fetch(`${supabaseUrl}/functions/v1/optimize-article-seo`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({ articleId: row.id }),
      })
      if (!seoResponse.ok) {
        console.error('optimize-article-seo failed', row.id, await seoResponse.text())
      }
    })(), `optimize-article-seo ${row.id}`)

    try {
      const communityResponse = await fetch(`${supabaseUrl}/functions/v1/sync-article-community-post`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({ articleId: row.id }),
      })
      if (!communityResponse.ok) {
        const message = await communityResponse.text()
        errors.push({ id: row.id, message: `sync-article-community-post failed: ${message.slice(0, 400)}` })
        console.error('sync-article-community-post failed', row.id, message)
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'sync-article-community-post failed'
      errors.push({ id: row.id, message })
      console.error('sync-article-community-post', row.id, e)
    }

    try {
      const r1 = await fetch(`${supabaseUrl}/functions/v1/notify-article-publication`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({ articleId: row.id }),
      })
      if (!r1.ok) {
        console.error('notify-article-publication failed', row.id, await r1.text())
      }
    } catch (e) {
      console.error('notify-article-publication', row.id, e)
    }

    const storyId = row.story_id as string | null
    if (storyId) {
      try {
        const r2 = await fetch(`${supabaseUrl}/functions/v1/notify-story-subscribers`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({
            storyId,
            articleId: row.id,
          }),
        })
        if (!r2.ok) {
          console.error('notify-story-subscribers failed', row.id, await r2.text())
        }
      } catch (e) {
        console.error('notify-story-subscribers', row.id, e)
      }
    }
  }

  return jsonResponse({
    success: true,
    dryRun,
    publishedCount: publishedIds.length,
    publishedIds,
    errors,
  })
})
