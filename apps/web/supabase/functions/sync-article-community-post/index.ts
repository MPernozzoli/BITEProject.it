import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'
const DEFAULT_OPENAI_MODEL = 'gpt-5.6-luna'
const MAX_SOURCE_CHARS = 18_000

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
  status: string
  published_at: string | null
  location_name: string | null
}

type AuthorRow = {
  profile_id: string
  public_profiles?: { name?: string | null; avatar_url?: string | null } | null
}

type CommunityPostPayload = {
  title_it?: string
  title_en?: string
  body_it?: string
  body_en?: string
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
  if (serviceRoleKey && token === serviceRoleKey) return { ok: true }

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

function readArticleId(body: Record<string, unknown>): string {
  return typeof body.articleId === 'string'
    ? body.articleId
    : typeof body.article_id === 'string'
      ? body.article_id
      : ''
}

function readOpenAiApiKey(): string {
  return Deno.env.get('OPENAI_API_KEY')?.trim() || ''
}

function readOpenAiModel(): string {
  return (
    Deno.env.get('COMMUNITY_OPENAI_MODEL')?.trim() ||
    Deno.env.get('SEO_OPENAI_MODEL')?.trim() ||
    Deno.env.get('OPENAI_MODEL')?.trim() ||
    DEFAULT_OPENAI_MODEL
  )
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
  if (typeof value.text === 'string') collectText(value.text, output)
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

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 84) || 'articolo'
}

function articleHref(article: ArticleRow): string {
  return `/logbook/${article.slug_it || article.slug}`
}

function titleFor(article: ArticleRow): string {
  return article.title_it?.trim() || article.title_en?.trim() || 'Nuovo articolo'
}

function docFromText(text: string) {
  return {
    type: 'doc',
    content: text
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean)
      .map((paragraph) => ({
        type: 'paragraph',
        content: [{ type: 'text', text: paragraph }],
      })),
  }
}

function buildSource(article: ArticleRow, authors: string[]): string {
  return JSON.stringify({
    title_it: article.title_it,
    title_en: article.title_en,
    excerpt_it: article.excerpt_it,
    excerpt_en: article.excerpt_en,
    content_it: plainTextFromDoc(article.content_it),
    content_en: plainTextFromDoc(article.content_en),
    location_name: article.location_name,
    authors,
    published_at: article.published_at,
  })
}

function buildPrompt(source: string): string {
  return `Write a BITE Crew community post announcing this newly published logbook article.

The post is for paying community members who already know BITE. Keep it warm, direct, specific, and editorial. Do not summarize every detail. Invite people to open the linked article below. Do not invent facts.

Return ONLY valid JSON with exactly:
- title_it: Italian post title, max 90 chars.
- title_en: English post title, max 90 chars.
- body_it: Italian body, 2 short paragraphs, max 900 chars total.
- body_en: English body, 2 short paragraphs, max 900 chars total.

Article source JSON:
${source}`
}

function extractOpenAiOutputText(json: unknown): string | null {
  if (isRecord(json) && typeof json.output_text === 'string') return json.output_text
  if (!isRecord(json) || !Array.isArray(json.output)) return null

  const chunks: string[] = []
  for (const outputItem of json.output) {
    if (!isRecord(outputItem) || !Array.isArray(outputItem.content)) continue
    for (const contentItem of outputItem.content) {
      if (isRecord(contentItem) && typeof contentItem.text === 'string') chunks.push(contentItem.text)
    }
  }
  return chunks.length ? chunks.join('') : null
}

async function callOpenAiPost(source: string): Promise<{ parsed: CommunityPostPayload; raw: unknown; model: string }> {
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
            'You write concise BITE Crew community posts as strict JSON. You are factual, specific, and non-clickbait.',
        },
        { role: 'user', content: buildPrompt(source) },
      ],
      text: { format: { type: 'json_object' } },
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    console.error('OpenAI community post error', response.status, text.slice(0, 800))
    throw new Error(`OpenAI error (${response.status})`)
  }

  const raw = await response.json()
  const outputText = extractOpenAiOutputText(raw)
  if (!outputText) throw new Error('OpenAI response missing output text')
  const parsed = JSON.parse(outputText) as unknown
  if (!isRecord(parsed)) throw new Error('OpenAI response is not an object')
  return { parsed: parsed as CommunityPostPayload, raw, model }
}

function cleanString(value: unknown, fallback: string, max: number): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : fallback.slice(0, max)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

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
  if (!articleId) return jsonResponse({ error: 'articleId is required' }, 400)

  const { data: article, error: articleError } = await supabase
    .from('logbook_articles')
    .select('id, slug, slug_it, slug_en, title_it, title_en, excerpt_it, excerpt_en, content_it, content_en, cover_image, status, published_at, location_name')
    .eq('id', articleId)
    .maybeSingle()

  if (articleError || !article) return jsonResponse({ error: 'Article not found' }, 404)
  const articleRow = article as ArticleRow
  if (articleRow.status !== 'published') {
    return jsonResponse({ success: true, skipped: 'not_published' })
  }

  const { data: existing } = await supabase
    .from('community_posts')
    .select('id')
    .eq('metadata->>source_article_id', articleId)
    .maybeSingle()

  if (existing && !force) {
    return jsonResponse({ success: true, skipped: 'already_synced', postId: existing.id })
  }

  const { data: authorRows, error: authorError } = await supabase
    .from('article_authors')
    .select('profile_id, public_profiles(name, avatar_url)')
    .eq('article_id', articleId)

  if (authorError) {
    console.error('article authors load failed', authorError)
    return jsonResponse({ error: 'Failed to load authors' }, 500)
  }

  const authors = (authorRows ?? []) as AuthorRow[]
  if (!authors.length) {
    return jsonResponse({ success: true, skipped: 'no_authors' })
  }

  const authorNames = authors
    .map((row) => row.public_profiles?.name?.trim())
    .filter((value): value is string => Boolean(value))

  try {
    const source = buildSource(articleRow, authorNames)
    const { parsed, raw, model } = await callOpenAiPost(source)
    const fallbackTitle = `Dal logbook: ${titleFor(articleRow)}`
    const bodyIt = cleanString(parsed.body_it, articleRow.excerpt_it || articleRow.excerpt_en || fallbackTitle, 900)
    const bodyEn = cleanString(parsed.body_en, articleRow.excerpt_en || articleRow.excerpt_it || fallbackTitle, 900)
    const titleIt = cleanString(parsed.title_it, fallbackTitle, 90)
    const titleEn = cleanString(parsed.title_en, articleRow.title_en || titleIt, 90)
    const href = articleHref(articleRow)
    const linkedResource = {
      kind: 'article',
      id: articleRow.id,
      label: titleFor(articleRow),
      subtitle: articleRow.location_name,
      href,
      coverImage: articleRow.cover_image,
    }

    const postPayload = {
      author_profile_id: authors[0].profile_id,
      title_it: titleIt,
      title_en: titleEn,
      slug: `logbook-${slugify(articleRow.slug_it || articleRow.slug)}-${articleRow.id.slice(0, 8)}`,
      excerpt_it: bodyIt.slice(0, 220),
      excerpt_en: bodyEn.slice(0, 220),
      content_it: docFromText(bodyIt),
      content_en: docFromText(bodyEn),
      cover_image: articleRow.cover_image,
      status: 'published',
      visibility: 'public',
      min_tier_id: null,
      published_at: new Date().toISOString(),
      post_type: 'text',
      linked_resources: [linkedResource],
      metadata: {
        source: 'logbook_article_publication',
        source_article_id: articleRow.id,
        openai_model: model,
        openai_raw_response: raw,
      },
    }

    const { data: post, error: postError } = existing
      ? await supabase
          .from('community_posts')
          .update(postPayload)
          .eq('id', existing.id)
          .select('id')
          .single()
      : await supabase
          .from('community_posts')
          .insert(postPayload)
          .select('id')
          .single()

    if (postError || !post) throw postError || new Error('Post not created')

    await supabase.from('community_post_authors').delete().eq('post_id', post.id)
    const { error: authorInsertError } = await supabase.from('community_post_authors').insert(
      authors.map((author, index) => ({
        post_id: post.id,
        profile_id: author.profile_id,
        author_order: index,
      })),
    )
    if (authorInsertError) throw authorInsertError

    return jsonResponse({ success: true, articleId, postId: post.id })
  } catch (error) {
    console.error('sync-article-community-post', articleId, error)
    const message = error instanceof Error ? error.message : 'Community post sync failed'
    return jsonResponse({ error: message.slice(0, 500) }, 502)
  }
})
