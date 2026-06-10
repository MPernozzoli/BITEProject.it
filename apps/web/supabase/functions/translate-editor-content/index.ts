import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

const MAX_INPUT_CHARS = 100_000
const AI_GATEWAY_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions'
const AI_MODEL = 'google/gemini-2.5-flash'

type Claims = Record<string, unknown> | null

function jsonResponse(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function parseJwtClaims(token: string): Claims {
  const parts = token.split('.')
  if (parts.length < 2) return null
  try {
    const payload = parts[1]
      .replaceAll('-', '+')
      .replaceAll('_', '/')
      .padEnd(Math.ceil(parts[1].length / 4) * 4, '=')
    return JSON.parse(atob(payload)) as Record<string, unknown>
  } catch {
    return null
  }
}

async function authorizeRequest(
  req: Request,
  // deno-lint-ignore no-explicit-any
  supabase: any,
): Promise<{ ok: true } | { ok: false; response: Response }> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return { ok: false, response: jsonResponse({ error: 'Unauthorized' }, 401) }
  }

  const token = authHeader.slice('Bearer '.length).trim()
  const claims = parseJwtClaims(token)

  if (claims?.role === 'service_role') {
    return { ok: true }
  }

  const userId = typeof claims?.sub === 'string' ? claims.sub : null
  if (!userId) {
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

function isNonEmpty(s: unknown): boolean {
  return typeof s === 'string' && s.trim().length > 0
}

function readString(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  return value.slice(0, max)
}

async function callAiJson(prompt: string, apiKey: string): Promise<Record<string, unknown>> {
  const res = await fetch(AI_GATEWAY_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    }),
  })

  if (!res.ok) {
    const t = await res.text()
    console.error('AI Gateway error', res.status, t.slice(0, 800))
    if (res.status === 429) throw new Error('Rate limit exceeded')
    if (res.status === 402) throw new Error('AI credits exhausted')
    throw new Error(`AI error (${res.status})`)
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const text = json?.choices?.[0]?.message?.content
  if (typeof text !== 'string') {
    throw new Error('Invalid AI response')
  }

  try {
    const parsed = JSON.parse(text) as unknown
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    throw new Error('AI returned non-JSON')
  }
}

const WAYPOINT_TRANSLATION_INSTRUCTIONS = `Sei un traduttore editoriale per BITE, progetto di viaggio in barca a vela (tono narrativo, preciso, naturale).
Traduci solo ciò che ti viene chiesto. Rispondi SOLO con l'oggetto JSON richiesto, senza testo extra.`

function buildWaypointPrompt(body: Record<string, unknown>): { prompt: string; keys: string[] } | null {
  const name_it = readString(body.name_it, 500)
  const name_en = readString(body.name_en, 500)
  const description_it = readString(body.description_it, 8000)
  const description_en = readString(body.description_en, 8000)

  const out: Record<string, string> = {}
  const tasks: string[] = []

  if (isNonEmpty(name_it) && !isNonEmpty(name_en)) {
    tasks.push(`Traduci "name_en" dall'italiano all'inglese. Italiano sorgente: ${JSON.stringify(name_it)}`)
    out.name_en = ''
  }
  if (isNonEmpty(name_en) && !isNonEmpty(name_it)) {
    tasks.push(`Traduci "name_it" dall'inglese all'italiano. English source: ${JSON.stringify(name_en)}`)
    out.name_it = ''
  }
  if (isNonEmpty(description_it) && !isNonEmpty(description_en)) {
    tasks.push(
      `Traduci "description_en" dall'italiano all'inglese. Italiano sorgente (testo puro, preserva paragrafi): ${JSON.stringify(description_it)}`,
    )
    out.description_en = ''
  }
  if (isNonEmpty(description_en) && !isNonEmpty(description_it)) {
    tasks.push(
      `Traduci "description_it" dall'inglese all'italiano. English source (plain text, preserve paragraphs): ${JSON.stringify(description_en)}`,
    )
    out.description_it = ''
  }

  if (tasks.length === 0) {
    return null
  }

  const keys = Object.keys(out)
  const prompt = `${WAYPOINT_TRANSLATION_INSTRUCTIONS}

Compiti (esegui tutti):
${tasks.join('\n')}

Rispondi SOLO con un oggetto JSON con le chiavi: ${keys.map((k) => JSON.stringify(k)).join(', ')}.
Valori: stringhe tradotte.`

  return { prompt, keys }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isTiptapEffectivelyEmpty(doc: unknown): boolean {
  if (!isRecord(doc) || doc.type !== 'doc') return true
  const content = doc.content
  if (!Array.isArray(content) || content.length === 0) return true
  for (const node of content) {
    if (!isRecord(node)) return false
    if (node.type === 'paragraph') {
      const c = node.content
      if (!Array.isArray(c)) continue
      for (const inline of c) {
        if (isRecord(inline) && typeof inline.text === 'string' && inline.text.trim()) return false
      }
      continue
    }
    return false
  }
  return true
}

const DOC_I18N_ATTR_KEYS = ['caption', 'alt', 'title', 'sceneLabel', 'anchorText'] as const

type DocStringTarget =
  | { kind: 'text'; node: Record<string, unknown> }
  | { kind: 'attr'; attrs: Record<string, unknown>; key: string }

function deepCloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function collectDocStringTargets(node: unknown, targets: DocStringTarget[]): void {
  if (!node || typeof node !== 'object') return
  const n = node as Record<string, unknown>
  const type = n.type

  if (type === 'text') {
    if (typeof n.text === 'string' && n.text.trim().length > 0) {
      targets.push({ kind: 'text', node: n })
    }
    return
  }

  if (n.attrs && isRecord(n.attrs)) {
    const attrs = n.attrs as Record<string, unknown>
    for (const key of DOC_I18N_ATTR_KEYS) {
      if (!(key in attrs)) continue
      const val = attrs[key]
      if (typeof val === 'string' && val.trim().length > 0) {
        targets.push({ kind: 'attr', attrs, key })
      }
    }
  }

  if (Array.isArray(n.content)) {
    for (const child of n.content) {
      collectDocStringTargets(child, targets)
    }
  }
}

function getTargetSourceText(t: DocStringTarget): string {
  return t.kind === 'text' ? String(t.node.text) : String(t.attrs[t.key])
}

function applyTargetTranslation(t: DocStringTarget, translated: string): void {
  if (t.kind === 'text') {
    t.node.text = translated
  } else {
    t.attrs[t.key] = translated
  }
}

type ArticleBodyPlan = {
  doc: Record<string, unknown>
  targets: DocStringTarget[]
  outKey: 'content_it' | 'content_en'
}

type ArticleTranslationPlan = {
  prompt: string | null
  metaKeys: string[]
  bodyPlan?: ArticleBodyPlan
}

function buildArticleTranslationPlan(reqBody: Record<string, unknown>): ArticleTranslationPlan | null {
  const title_it = readString(reqBody.title_it, 500)
  const title_en = readString(reqBody.title_en, 500)
  const excerpt_it = readString(reqBody.excerpt_it, 4000)
  const excerpt_en = readString(reqBody.excerpt_en, 4000)
  const content_it = reqBody.content_it
  const content_en = reqBody.content_en

  const metaTasks: string[] = []
  const metaKeys: string[] = []

  if (isNonEmpty(title_it) && !isNonEmpty(title_en)) {
    metaTasks.push(`"title_en": traduci in inglese il titolo: ${JSON.stringify(title_it)}`)
    metaKeys.push('title_en')
  }
  if (isNonEmpty(title_en) && !isNonEmpty(title_it)) {
    metaTasks.push(`"title_it": traduci in italiano il titolo: ${JSON.stringify(title_en)}`)
    metaKeys.push('title_it')
  }
  if (isNonEmpty(excerpt_it) && !isNonEmpty(excerpt_en)) {
    metaTasks.push(`"excerpt_en": traduci in inglese la sinossi/estratto: ${JSON.stringify(excerpt_it)}`)
    metaKeys.push('excerpt_en')
  }
  if (isNonEmpty(excerpt_en) && !isNonEmpty(excerpt_it)) {
    metaTasks.push(`"excerpt_it": traduci in italiano la sinossi/estratto: ${JSON.stringify(excerpt_en)}`)
    metaKeys.push('excerpt_it')
  }

  const enDoc = isRecord(content_en) ? content_en : null
  const itDoc = isRecord(content_it) ? content_it : null
  const enHas = Boolean(enDoc && !isTiptapEffectivelyEmpty(enDoc))
  const itHas = Boolean(itDoc && !isTiptapEffectivelyEmpty(itDoc))

  let bodyPlan: ArticleBodyPlan | undefined

  if (enDoc && enHas && (!itDoc || isTiptapEffectivelyEmpty(itDoc))) {
    const doc = deepCloneJson(enDoc) as Record<string, unknown>
    const targets: DocStringTarget[] = []
    collectDocStringTargets(doc, targets)
    bodyPlan = { doc, targets, outKey: 'content_it' }
  } else if (itDoc && itHas && (!enDoc || isTiptapEffectivelyEmpty(enDoc))) {
    const doc = deepCloneJson(itDoc) as Record<string, unknown>
    const targets: DocStringTarget[] = []
    collectDocStringTargets(doc, targets)
    bodyPlan = { doc, targets, outKey: 'content_en' }
  }

  if (metaKeys.length === 0 && !bodyPlan) {
    return null
  }

  if (metaKeys.length === 0 && bodyPlan && bodyPlan.targets.length === 0) {
    return { prompt: null, metaKeys: [], bodyPlan }
  }

  const responseKeys: string[] = [...metaKeys]
  if (bodyPlan && bodyPlan.targets.length > 0) {
    responseKeys.push('docStrings')
  }

  const directionLabel =
    bodyPlan?.outKey === 'content_it'
      ? 'inglese → italiano'
      : bodyPlan?.outKey === 'content_en'
        ? 'italiano → inglese'
        : ''

  const parts: string[] = [
    `Sei un traduttore editoriale per BITE (viaggio in barca a vela). Rispondi SOLO con JSON valido, senza testo fuori dall'oggetto.`,
  ]

  if (metaTasks.length > 0) {
    parts.push(`Campi meta:\n${metaTasks.join('\n')}`)
  }

  if (bodyPlan && bodyPlan.targets.length > 0) {
    const sources = bodyPlan.targets.map((t: DocStringTarget) => getTargetSourceText(t))
    parts.push(
      `Corpo articolo (TipTap): la struttura del documento è già fissata lato server. Ti viene dato l'array JSON "docStrings" con ${sources.length} stringhe in ordine di attraversamento depth-first del documento.`,
    )
    parts.push(
      `Ogni elemento corrisponde a: testo in un nodo "text" (rispetta grassetti/link/markup solo come testo continuo nel frammento), oppure didascalie/accessibilità (caption, alt, title di immagini/mediaFigure/video), oppure etichette testuali degli anchor mappa (sceneLabel, anchorText).`,
    )
    parts.push(
      `Traduci ogni stringa ${directionLabel ? `(${directionLabel})` : ''}. Mantieni interruzioni di riga e spazi significativi; non unire né spezzare elementi: l'array "docStrings" nella risposta deve avere ESATTAMENTE ${sources.length} stringhe nello stesso ordine.`,
    )
    parts.push(`Non tradurre URL, percorsi file, codici, né UUID. I nomi propri geografici marittimi lasciali riconoscibili.`)
    parts.push(`docStrings sorgente:\n${JSON.stringify(sources)}`)
  }

  parts.push(
    `Rispondi con un unico oggetto JSON con le chiavi: ${responseKeys.map((k) => JSON.stringify(k)).join(', ')}.` +
      (bodyPlan && bodyPlan.targets.length > 0
        ? ` Il valore di "docStrings" deve essere un array di stringhe della stessa lunghezza della sorgente.`
        : ''),
  )

  const prompt = parts.join('\n\n')

  return { prompt, metaKeys, bodyPlan }
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
  const apiKey = Deno.env.get('LOVABLE_API_KEY')?.trim()

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Server configuration error' }, 500)
  }

  if (!apiKey) {
    return jsonResponse({ error: 'LOVABLE_API_KEY non configurata.' }, 503)
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)
  const authorization = await authorizeRequest(req, supabase)
  if (!authorization.ok) {
    return authorization.response
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400)
  }

  const kind = body.kind

  if (kind === 'waypoint') {
    const built = buildWaypointPrompt(body)
    if (!built) {
      return jsonResponse({ ok: true, skipped: 'nothing_to_translate', fields: {} }, 200)
    }
    if (built.prompt.length > MAX_INPUT_CHARS) {
      return jsonResponse({ error: 'Input troppo grande per la traduzione' }, 413)
    }
    try {
      const fields = await callAiJson(built.prompt, apiKey)
      const out: Record<string, unknown> = {}
      for (const key of built.keys) {
        const v = fields[key]
        if (typeof v === 'string') {
          out[key] = v
        }
      }
      if (Object.keys(out).length === 0) {
        return jsonResponse({ error: 'Traduzione non valida (risposta vuota)' }, 502)
      }
      return jsonResponse({ ok: true, fields: out }, 200)
    } catch (e) {
      console.error('translate-editor-content', e)
      return jsonResponse({ error: 'Traduzione non riuscita' }, 502)
    }
  }

  if (kind === 'article') {
    const plan = buildArticleTranslationPlan(body)
    if (!plan) {
      return jsonResponse({ ok: true, skipped: 'nothing_to_translate', fields: {} }, 200)
    }

    const out: Record<string, unknown> = {}

    if (plan.prompt === null) {
      if (plan.bodyPlan) {
        out[plan.bodyPlan.outKey] = plan.bodyPlan.doc
      }
      return jsonResponse({ ok: true, fields: out }, 200)
    }

    if (plan.prompt.length > MAX_INPUT_CHARS) {
      return jsonResponse({ error: 'Input troppo grande per la traduzione' }, 413)
    }

    try {
      const parsed = await callAiJson(plan.prompt, apiKey)

      for (const key of plan.metaKeys) {
        const v = parsed[key]
        if (typeof v === 'string') {
          out[key] = v
        }
      }

      if (plan.metaKeys.length > 0 && plan.metaKeys.some((k) => typeof out[k] !== 'string')) {
        return jsonResponse({ error: 'Traduzione meta incompleta' }, 502)
      }

      if (plan.bodyPlan) {
        if (plan.bodyPlan.targets.length === 0) {
          out[plan.bodyPlan.outKey] = plan.bodyPlan.doc
        } else {
          const arr = parsed.docStrings
          if (!Array.isArray(arr) || arr.length !== plan.bodyPlan.targets.length) {
            return jsonResponse(
              { error: `docStrings: attesi ${plan.bodyPlan.targets.length} elementi, modello incoerente` },
              502,
            )
          }
          for (let i = 0; i < plan.bodyPlan.targets.length; i++) {
            const s = arr[i]
            if (typeof s !== 'string') {
              return jsonResponse({ error: 'docStrings: elemento non stringa' }, 502)
            }
            applyTargetTranslation(plan.bodyPlan.targets[i]!, s)
          }
          out[plan.bodyPlan.outKey] = plan.bodyPlan.doc
        }
      }

      if (Object.keys(out).length === 0) {
        return jsonResponse({ error: 'Traduzione non valida (risposta vuota)' }, 502)
      }

      return jsonResponse({ ok: true, fields: out }, 200)
    } catch (e) {
      console.error('translate-editor-content', e)
      return jsonResponse({ error: 'Traduzione non riuscita' }, 502)
    }
  }

  return jsonResponse({ error: 'kind must be waypoint or article' }, 400)
})
