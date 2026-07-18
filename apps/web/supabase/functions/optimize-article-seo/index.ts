import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'
const DEFAULT_OPENAI_MODEL = 'gpt-5.6-luna'
const MAX_SOURCE_CHARS = 24_000

type ArticleRow = {
  id: string
  slug: string
  slug_it: string | null
  slug_en: string | null
  title_it: string | null
  title_en: string | null
  excerpt_it: string | null
  excerpt_en: string | null
  content_it: unknown
  content_en: unknown
  cover_image: string | null
  category: string | null
  status: string
  published_at: string | null
  updated_at: string | null
  location_name: string | null
  voyage_id: string | null
}

type SeoPayload = {
  title_it?: string
  title_en?: string
  description_it?: string
  description_en?: string
  social_title_it?: string
  social_title_en?: string
  social_description_it?: string
  social_description_en?: string
  keywords_it?: unknown
  keywords_en?: unknown
  image_alt_it?: string
  image_alt_en?: string
  structured_data?: unknown
  recommendations?: unknown
}

function jsonResponse(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function authorizeRequest(
  req: Request,
  supabase: ReturnType<typeof createClient>,
): Promise<{ ok: true } | { ok: false; response: Response }> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return { ok: false, response: jsonResponse({ error: 'Unauthorized' }, 401) }
  }

  const token = authHeader.slice('Bearer '.length).trim()
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (serviceRoleKey && token === serviceRoleKey) {
    return { ok: true }
  }

  const { data: userData, error: userError } = await supabase.auth.getUser(token)
  const userId = userData?.user?.id
  if (userError || !userId) {
    return { ok: false, response: jsonResponse({ error: 'Unauthorized' }, 401) }
  }

  const { data: isAdmin, error } = await supabase.rpc('has_role', {
    _user_id: userId,
    _role: 'admin',
  })

  if (error || !isAdmin) {
    return { ok: false, response: jsonResponse({ error: 'Forbidden' }, 403) }
  }

  return { ok: true }
}

function readOpenAiApiKey(): string {
  return Deno.env.get('OPENAI_API_KEY')?.trim() || ''
}

function readOpenAiModel(): string {
  return (
    Deno.env.get('SEO_OPENAI_MODEL')?.trim() ||
    Deno.env.get('OPENAI_MODEL')?.trim() ||
    DEFAULT_OPENAI_MODEL
  )
}

function readArticleId(body: Record<string, unknown>): string {
  return typeof body.articleId === 'string'
    ? body.articleId
    : typeof body.article_id === 'string'
      ? body.article_id
      : ''
}

function collectText(value: unknown, output: string[]): void {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed) output.push(trimmed)
    return
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectText(item, output))
    return
  }

  if (!isRecord(value)) return

  if (typeof value.text === 'string') {
    collectText(value.text, output)
  }

  if (isRecord(value.attrs)) {
    for (const key of ['alt', 'title', 'caption', 'sceneLabel', 'anchorText']) {
      collectText(value.attrs[key], output)
    }
  }

  collectText(value.content, output)
}

function plainTextFromDoc(value: unknown): string {
  const chunks: string[] = []
  collectText(value, chunks)
  return chunks.join('\n').replace(/\n{3,}/g, '\n\n').slice(0, MAX_SOURCE_CHARS)
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function buildSourceDocument(article: ArticleRow, tags: string[], authors: string[]): string {
  return JSON.stringify({
    id: article.id,
    slug: article.slug,
    slug_it: article.slug_it,
    slug_en: article.slug_en,
    title_it: article.title_it,
    title_en: article.title_en,
    excerpt_it: article.excerpt_it,
    excerpt_en: article.excerpt_en,
    content_it: plainTextFromDoc(article.content_it),
    content_en: plainTextFromDoc(article.content_en),
    category: article.category,
    location_name: article.location_name,
    tags,
    authors,
    published_at: article.published_at,
    updated_at: article.updated_at,
  })
}

function buildPrompt(source: string): string {
  return `Generate production SEO optimization for this bilingual BITE logbook article.

BITE is an editorial sailing/travel project aboard S/Y Spritz. Keep the voice editorial, precise, natural, and non-clickbait.

Return ONLY valid JSON with exactly these top-level keys:
- title_it, title_en: SEO title, max 62 characters each, no site suffix.
- description_it, description_en: meta description, 140-158 characters each.
- social_title_it, social_title_en: Open Graph/Twitter title, max 70 characters each.
- social_description_it, social_description_en: social description, max 180 characters each.
- keywords_it, keywords_en: arrays of 6-12 concise search phrases.
- image_alt_it, image_alt_en: cover image alt text if a cover is present, otherwise empty string.
- structured_data: object with optional additions for BlogPosting only: about, mentions, contentLocation, keywords. Do not include @context, @type, url, image, author, publisher, datePublished, dateModified.
- recommendations: object with concise arrays "on_page" and "content_gaps" for editor review.

Do not invent facts. If a location, route, date, person, or vessel is not in the source, omit it.

Article source JSON:
${source}`
}

function extractOpenAiOutputText(json: unknown): string | null {
  if (isRecord(json) && typeof json.output_text === 'string') {
    return json.output_text
  }

  if (!isRecord(json) || !Array.isArray(json.output)) {
    return null
  }

  const chunks: string[] = []
  for (const outputItem of json.output) {
    if (!isRecord(outputItem) || !Array.isArray(outputItem.content)) continue
    for (const contentItem of outputItem.content) {
      if (isRecord(contentItem) && typeof contentItem.text === 'string') {
        chunks.push(contentItem.text)
      }
    }
  }

  return chunks.length > 0 ? chunks.join('') : null
}

async function callOpenAiJson(prompt: string): Promise<{ parsed: SeoPayload; raw: unknown; model: string }> {
  const apiKey = readOpenAiApiKey()
  if (!apiKey) throw new Error('OPENAI_API_KEY missing')

  const model = readOpenAiModel()
  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: 'system',
          content:
            'You are a technical SEO editor. You produce concise, factual, bilingual SEO metadata as strict JSON.',
        },
        { role: 'user', content: prompt },
      ],
      text: { format: { type: 'json_object' } },
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    console.error('OpenAI SEO error', response.status, text.slice(0, 800))
    throw new Error(`OpenAI error (${response.status})`)
  }

  const raw = await response.json()
  const outputText = extractOpenAiOutputText(raw)
  if (!outputText) throw new Error('OpenAI response missing output text')

  const parsed = JSON.parse(outputText) as unknown
  if (!isRecord(parsed)) throw new Error('OpenAI response is not an object')

  return { parsed: parsed as SeoPayload, raw, model }
}

function cleanString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, max) : null
}

function cleanKeywords(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12)
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
  const authorization = await authorizeRequest(req, supabase)
  if (!authorization.ok) return authorization.response

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400)
  }

  const articleId = readArticleId(body)
  const force = body.force === true
  if (!articleId) {
    return jsonResponse({ error: 'articleId is required' }, 400)
  }

  const { data: article, error: articleError } = await supabase
    .from('logbook_articles')
    .select('id, slug, slug_it, slug_en, title_it, title_en, excerpt_it, excerpt_en, content_it, content_en, cover_image, category, status, published_at, updated_at, location_name, voyage_id')
    .eq('id', articleId)
    .maybeSingle()

  if (articleError || !article) {
    return jsonResponse({ error: 'Article not found' }, 404)
  }

  if ((article as ArticleRow).status !== 'published') {
    return jsonResponse({ success: true, skipped: 'not_published' })
  }

  try {
    const [{ data: tagRows }, { data: authorRows }] = await Promise.all([
      supabase.from('article_tags').select('tags(name)').eq('article_id', articleId),
      supabase.from('article_authors').select('public_profiles(name)').eq('article_id', articleId),
    ])

    const tags = (tagRows ?? [])
      .map((row) => {
        const tag = (row as { tags?: { name?: string } | null }).tags
        return tag?.name?.trim()
      })
      .filter((value): value is string => Boolean(value))

    const authors = (authorRows ?? [])
      .map((row) => {
        const profile = (row as { public_profiles?: { name?: string } | null }).public_profiles
        return profile?.name?.trim()
      })
      .filter((value): value is string => Boolean(value))

    const source = buildSourceDocument(article as ArticleRow, tags, authors)
    const sourceHash = await sha256Hex(source)

    if (!force) {
      const { data: existing, error: existingError } = await supabase
        .from('article_seo_optimizations')
        .select('source_hash, status')
        .eq('article_id', articleId)
        .maybeSingle()

      if (existingError) throw existingError

      if (existing?.source_hash === sourceHash) {
        return jsonResponse({
          success: true,
          articleId,
          status: existing.status,
          skipped: 'unchanged',
        })
      }
    }

    await supabase.from('article_seo_optimizations').upsert({
      article_id: articleId,
      status: 'processing',
      source_hash: sourceHash,
      error_message: null,
    }, { onConflict: 'article_id' })

    const { parsed, raw, model } = await callOpenAiJson(buildPrompt(source))

    const structuredData = isRecord(parsed.structured_data) ? parsed.structured_data : {}
    const recommendations = isRecord(parsed.recommendations) ? parsed.recommendations : {}

    const { error: updateError } = await supabase.from('article_seo_optimizations').upsert({
      article_id: articleId,
      status: 'ready',
      source_hash: sourceHash,
      model,
      generated_at: new Date().toISOString(),
      error_message: null,
      title_it: cleanString(parsed.title_it, 80),
      title_en: cleanString(parsed.title_en, 80),
      description_it: cleanString(parsed.description_it, 220),
      description_en: cleanString(parsed.description_en, 220),
      social_title_it: cleanString(parsed.social_title_it, 90),
      social_title_en: cleanString(parsed.social_title_en, 90),
      social_description_it: cleanString(parsed.social_description_it, 240),
      social_description_en: cleanString(parsed.social_description_en, 240),
      keywords_it: cleanKeywords(parsed.keywords_it),
      keywords_en: cleanKeywords(parsed.keywords_en),
      image_alt_it: cleanString(parsed.image_alt_it, 220),
      image_alt_en: cleanString(parsed.image_alt_en, 220),
      structured_data: structuredData,
      recommendations: recommendations,
      raw_response: raw,
    }, { onConflict: 'article_id' })

    if (updateError) throw updateError

    return jsonResponse({ success: true, articleId, status: 'ready' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'SEO optimization failed'
    console.error('optimize-article-seo', articleId, error)
    await supabase.from('article_seo_optimizations').upsert({
      article_id: articleId,
      status: 'failed',
      error_message: message.slice(0, 500),
    }, { onConflict: 'article_id' })
    return jsonResponse({ error: 'SEO optimization failed' }, 502)
  }
})
