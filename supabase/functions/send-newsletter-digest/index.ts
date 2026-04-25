import { createClient } from 'npm:@supabase/supabase-js@2'
import { PUBLIC_SITE_URL } from '../_shared/email-config.ts'
import { normalizeLanguage } from '../_shared/newsletter-helpers.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

type Claims = Record<string, unknown> | null
type DigestArticleRow = {
  id: string
  slug: string
  title_en: string | null
  title_it: string | null
  excerpt_en: string | null
  excerpt_it: string | null
  cover_image: string | null
  published_at: string | null
  location_name: string | null
  stories:
    | {
        slug: string
        title_en: string | null
        title_it: string | null
      }
    | null
}

type DigestProfileRow = {
  name: string | null
  preferred_language: string | null
  secondary_language: string | null
}

type DigestRecipientRow = {
  email: string
  preferred_language: string | null
  profiles: DigestProfileRow | DigestProfileRow[] | null
}

function jsonResponse(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function authorizeRequest(
  req: Request,
  supabase: ReturnType<typeof createClient>
): Promise<{ ok: true } | { ok: false; response: Response }> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return {
      ok: false,
      response: jsonResponse({ error: 'Unauthorized' }, 401),
    }
  }

  const token = authHeader.slice('Bearer '.length).trim()
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (serviceRoleKey && token === serviceRoleKey) {
    return { ok: true }
  }

  const { data: userData, error: userError } = await supabase.auth.getUser(token)
  const userId = userData?.user?.id
  if (userError || !userId) {
    return {
      ok: false,
      response: jsonResponse({ error: 'Unauthorized' }, 401),
    }
  }

  const { data: isAdmin, error } = await supabase.rpc('has_role', {
    _user_id: userId,
    _role: 'admin',
  } as any)

  if (error || !isAdmin) {
    return {
      ok: false,
      response: jsonResponse({ error: 'Forbidden' }, 403),
    }
  }

  return { ok: true }
}

function localizeValue(
  language: string | null,
  itValue: string | null | undefined,
  enValue: string | null | undefined,
  fallback = ''
): string {
  const normalized = normalizeLanguage(language)
  if (normalized === 'en') {
    return enValue?.trim() || itValue?.trim() || fallback
  }

  return itValue?.trim() || enValue?.trim() || fallback
}

function formatPeriodLabel(
  startDate: Date,
  endDate: Date,
  language: string | null
): string {
  const locale = normalizeLanguage(language) === 'en' ? 'en-GB' : 'it-IT'
  const formatter = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })

  const startLabel = formatter.format(startDate)
  const endLabel = formatter.format(endDate)

  return startLabel === endLabel ? startLabel : `${startLabel} - ${endLabel}`
}

function buildIssueLabel(language: string | null, periodLabel: string): string {
  return normalizeLanguage(language) === 'en'
    ? `Weekly digest · ${periodLabel}`
    : `Digest settimanale · ${periodLabel}`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Server configuration error' }, 500)
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)
  const authorization = await authorizeRequest(req, supabase as any)
  if (!authorization.ok) {
    return authorization.response
  }

  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  const requestedDays =
    typeof body.days === 'number' && Number.isFinite(body.days) && body.days > 0
      ? Math.min(Math.round(body.days), 30)
      : 7

  const endDate = new Date(
    typeof body.endDate === 'string' && body.endDate.trim()
      ? body.endDate
      : new Date().toISOString()
  )
  if (Number.isNaN(endDate.getTime())) {
    return jsonResponse({ error: 'Invalid endDate' }, 400)
  }

  const startDate = new Date(
    typeof body.startDate === 'string' && body.startDate.trim()
      ? body.startDate
      : endDate.toISOString()
  )
  if (Number.isNaN(startDate.getTime())) {
    return jsonResponse({ error: 'Invalid startDate' }, 400)
  }

  if (!(typeof body.startDate === 'string' && body.startDate.trim())) {
    startDate.setUTCDate(endDate.getUTCDate() - (requestedDays - 1))
  }
  startDate.setUTCHours(0, 0, 0, 0)
  endDate.setUTCHours(23, 59, 59, 999)

  const recipientEmail =
    typeof body.recipientEmail === 'string' && body.recipientEmail.trim()
      ? body.recipientEmail.trim().toLowerCase()
      : null
  const articleIds = Array.isArray(body.articleIds)
    ? body.articleIds.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : []

  let articlesQuery = supabase
    .from('logbook_articles')
    .select(
      'id, slug, title_en, title_it, excerpt_en, excerpt_it, cover_image, published_at, location_name, story_id, stories:stories!logbook_articles_story_id_fkey(slug, title_en, title_it)'
    )
    .eq('status', 'published')
    .order('published_at', { ascending: false, nullsFirst: false })

  if (articleIds.length > 0) {
    articlesQuery = articlesQuery.in('id', articleIds)
  } else {
    articlesQuery = articlesQuery
      .gte('published_at', startDate.toISOString())
      .lte('published_at', endDate.toISOString())
  }

  const { data: articles, error: articlesError } = await articlesQuery

  if (articlesError) {
    console.error('Failed to load digest articles', articlesError)
    return jsonResponse({ error: 'Failed to load digest articles' }, 500)
  }

  if (!articles?.length) {
    return jsonResponse({
      success: true,
      queued: 0,
      failed: 0,
      skipped: 0,
      reason: 'no_articles',
    })
  }

  let recipientsQuery = supabase
    .from('newsletter_subscribers')
    .select(
      'id, email, profile_id, preferred_language, subscribed, profiles:profiles!newsletter_subscribers_profile_id_fkey(name, preferred_language, secondary_language)'
    )
    .eq('subscribed', true)

  if (recipientEmail) {
    recipientsQuery = recipientsQuery.eq('email', recipientEmail)
  }

  const { data: recipients, error: recipientsError } = await recipientsQuery

  if (recipientsError) {
    console.error('Failed to load newsletter recipients for digest', recipientsError)
    return jsonResponse({ error: 'Failed to load digest recipients' }, 500)
  }

  if (!recipients?.length) {
    return jsonResponse({
      success: true,
      queued: 0,
      failed: 0,
      skipped: 0,
      reason: 'no_recipients',
    })
  }

  const { data: preferenceRows, error: preferenceError } = await supabase
    .from('email_notification_preferences')
    .select('email, digest_enabled')
    .in(
      'email',
      (recipients as DigestRecipientRow[]).map((recipient) => recipient.email)
    )

  if (preferenceError) {
    console.error('Failed to load digest preferences', preferenceError)
    return jsonResponse({ error: 'Failed to load digest preferences' }, 500)
  }

  const digestPreferenceMap = new Map(
    (preferenceRows ?? []).map((row) => [
      row.email.toLowerCase(),
      row.digest_enabled,
    ])
  )

  const eligibleRecipients = (recipients as DigestRecipientRow[]).filter(
    (recipient) => digestPreferenceMap.get(recipient.email.toLowerCase()) ?? true
  )

  if (!eligibleRecipients.length) {
    return jsonResponse({
      success: true,
      queued: 0,
      failed: 0,
      skipped: recipients.length,
      reason: 'all_recipients_opted_out',
    })
  }

  const results = await Promise.allSettled(
    eligibleRecipients.map(async (recipient) => {
      const profile = Array.isArray(recipient.profiles)
        ? recipient.profiles[0] ?? null
        : recipient.profiles ?? null
      const language =
        profile?.preferred_language ?? recipient.preferred_language ?? 'it'
      const normalizedLanguage = normalizeLanguage(language)
      const periodLabel = formatPeriodLabel(startDate, endDate, normalizedLanguage)
      const issueLabel =
        typeof body.issueLabel === 'string' && body.issueLabel.trim()
          ? body.issueLabel.trim()
          : buildIssueLabel(normalizedLanguage, periodLabel)

      const digestArticles = (articles as unknown as DigestArticleRow[]).map((article) => ({
        title: localizeValue(
          normalizedLanguage,
          article.title_it,
          article.title_en,
          'Articolo'
        ),
        excerpt: localizeValue(
          normalizedLanguage,
          article.excerpt_it,
          article.excerpt_en,
          ''
        ),
        url: `${PUBLIC_SITE_URL}/logbook/${article.slug}`,
        coverImageUrl: article.cover_image,
        storyTitle: article.stories
          ? localizeValue(
              normalizedLanguage,
              article.stories.title_it,
              article.stories.title_en,
              ''
            )
          : null,
        storyUrl: article.stories?.slug
          ? `${PUBLIC_SITE_URL}/logbook/story/${article.stories.slug}`
          : null,
        publishedLabel: article.published_at
          ? new Intl.DateTimeFormat(
              normalizedLanguage === 'en' ? 'en-GB' : 'it-IT',
              {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              }
            ).format(new Date(article.published_at))
          : null,
        locationName: article.location_name ?? null,
      }))

      const response = await fetch(
        `${supabaseUrl}/functions/v1/send-transactional-email`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({
            templateName: 'newsletter-digest',
            recipientEmail: recipient.email,
            idempotencyKey: `newsletter-digest:${issueLabel}:${recipient.email}`,
            templateData: {
              language: normalizedLanguage,
              recipientName: profile?.name ?? null,
              issueLabel,
              periodLabel,
              articleCount: digestArticles.length,
              heroImageUrl: digestArticles[0]?.coverImageUrl ?? null,
              articles: digestArticles,
            },
          }),
        }
      )

      if (!response.ok) {
        const message = await response.text()
        throw new Error(`Failed to queue digest for ${recipient.email}: ${message}`)
      }
    })
  )

  const queued = results.filter((result) => result.status === 'fulfilled').length
  const failed = results.length - queued
  const skipped = (recipients?.length ?? 0) - eligibleRecipients.length

  if (failed > 0) {
    console.error(
      'Some newsletter digest deliveries failed',
      results
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map((result) => result.reason)
    )
  }

  return jsonResponse({ success: true, queued, failed, skipped })
})
