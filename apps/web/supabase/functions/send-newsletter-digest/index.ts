/**
 * Digest periodico degli articoli pubblicati ("Appunti dalla barca").
 *
 * Finestra temporale, destinatari eleggibili (`digest_enabled`), lingua per
 * destinatario, idempotency key e conteggi vivono in
 * `@pynkstudio/newsletterapp`. Qui resta ciò che è di BITE: *quali* contenuti
 * entrano nel digest e come sono impaginati nel payload del template.
 *
 * L'endpoint accetta anche `articleIds`, che il factory generico del package
 * non conosce: è una scorciatoia per gli invii di prova dall'admin, quindi la
 * function è montata a mano sopra le primitive del package invece che con
 * `createDigestHandler`.
 */
import {
  authorizeOperator,
  localizeValue,
  normalizeLanguage,
  runNewsletterDigest,
  type DigestRange,
} from '../_shared/newsletterapp.ts'
import { createNewsletterContext, newsletterConfig } from '../_shared/newsletter.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { localizedUrl, trackedUrl } from '../_shared/email-config.ts'
import { EMAIL_TRACKING } from '../_shared/tracking.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type DigestArticle = {
  id: string
  slug: string
  title_en: string | null
  title_it: string | null
  excerpt_en: string | null
  excerpt_it: string | null
  cover_image: string | null
  published_at: string | null
  location_name: string | null
  stories: { slug: string; title_en: string | null; title_it: string | null } | null
}

function jsonResponse(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function dateFormatter(language: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(normalizeLanguage(newsletterConfig, language) === 'en' ? 'en-GB' : 'it-IT', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function formatPeriodLabel(range: DigestRange, language: string): string {
  const formatter = dateFormatter(language)
  const start = formatter.format(range.startDate)
  const end = formatter.format(range.endDate)
  return start === end ? start : `${start} - ${end}`
}

function formatIssueLabel(periodLabel: string, language: string): string {
  return normalizeLanguage(newsletterConfig, language) === 'en'
    ? `Onboard news · ${periodLabel}`
    : `Notizie di bordo · ${periodLabel}`
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
  const context = createNewsletterContext({ supabase, supabaseUrl, serviceRoleKey })

  const authHeader = req.headers.get('Authorization')
  const auth = await authorizeOperator(context, {
    bearerToken: authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : null,
    cronSecretHeader: req.headers.get('x-cron-secret'),
  })

  if (!auth.ok) {
    return jsonResponse({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, auth.status)
  }

  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  const articleIds = Array.isArray(body.articleIds)
    ? body.articleIds.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : []

  try {
    const result = await runNewsletterDigest<DigestArticle>(context, {
      startDate: typeof body.startDate === 'string' ? body.startDate : null,
      endDate: typeof body.endDate === 'string' ? body.endDate : null,
      days: typeof body.days === 'number' ? body.days : null,
      recipientEmail: typeof body.recipientEmail === 'string' ? body.recipientEmail : null,
      issueLabel: typeof body.issueLabel === 'string' ? body.issueLabel : null,
      formatPeriodLabel,
      formatIssueLabel,

      loadItems: async ({ startDate, endDate }) => {
        let query = supabase
          .from('logbook_articles')
          .select(
            'id, slug, title_en, title_it, excerpt_en, excerpt_it, cover_image, published_at, location_name, story_id, stories:stories!logbook_articles_story_id_fkey(slug, title_en, title_it)',
          )
          .eq('status', 'published')
          .order('published_at', { ascending: false, nullsFirst: false })

        // Una lista esplicita di articoli ignora la finestra: serve agli invii
        // di prova dall'admin, che vogliono un contenuto preciso.
        query = articleIds.length
          ? query.in('id', articleIds)
          : query.gte('published_at', startDate.toISOString()).lte('published_at', endDate.toISOString())

        const { data, error } = await query
        if (error) throw error
        return (data ?? []) as unknown as DigestArticle[]
      },

      buildTemplateData: ({ recipient, issueLabel, periodLabel, items, range }) => {
        // La campagna è la finestra del digest, non l'etichetta dell'edizione:
        // quella è tradotta, e due lingue produrrebbero due campagne per lo
        // stesso invio.
        const digest = {
          ...EMAIL_TRACKING.newsletter,
          campaign: `digest-${range.endDate.toISOString().slice(0, 10)}`,
        }

        const articles = items.map((article) => ({
          title: localizeValue(
            newsletterConfig,
            recipient.language,
            { it: article.title_it, en: article.title_en },
            'Articolo',
          ),
          excerpt: localizeValue(newsletterConfig, recipient.language, {
            it: article.excerpt_it,
            en: article.excerpt_en,
          }),
          url: trackedUrl(recipient.language, `/logbook/${article.slug}`, digest),
          coverImageUrl: article.cover_image,
          storyTitle: article.stories
            ? localizeValue(newsletterConfig, recipient.language, {
                it: article.stories.title_it,
                en: article.stories.title_en,
              })
            : null,
          storyUrl: article.stories?.slug
            ? trackedUrl(recipient.language, `/logbook/story/${article.stories.slug}`, {
                ...digest,
                content: 'story',
              })
            : null,
          publishedLabel: article.published_at
            ? dateFormatter(recipient.language).format(new Date(article.published_at))
            : null,
          locationName: article.location_name ?? null,
        }))

        return {
          language: recipient.language,
          recipientName: recipient.name,
          issueLabel,
          periodLabel,
          articleCount: articles.length,
          heroImageUrl: articles[0]?.coverImageUrl ?? null,
          articles,
        }
      },
    })

    return jsonResponse({ success: true, ...result })
  } catch (error) {
    console.error('Newsletter digest failed', error)
    return jsonResponse({ error: 'Failed to run newsletter digest' }, 500)
  }
})
