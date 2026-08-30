/**
 * Vocabolario e grammatica dei tracker di sorgente (UTM).
 *
 * Un solo posto dove si decide come si scrive `utm_source=facebook` e come lo
 * si rilegge, perché i punti che generano un link tracciato sono molti e
 * distanti fra loro: il tasto Condividi di un articolo, i tool MCP che
 * restituiscono `url_it`/`url_en`, l'automazione che promuove nei gruppi
 * Facebook, il generatore in admin. Se ognuno normalizzasse a modo suo,
 * `Facebook`, `facebook` e `FB` diventerebbero tre sorgenti distinte nei
 * report e il confronto fra canali sarebbe una bugia.
 *
 * Modulo volutamente puro — nessun import, nessun accesso a `window` — perché
 * lo importano sia il client (Vite) sia il server MCP (function Vercel), come
 * già succede per `lib/mcp-scopes.ts`. La parte che tocca il browser sta in
 * `lib/attribution.ts`.
 */

/** I cinque parametri standard, nell'ordine in cui vanno scritti nell'URL. */
export const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;

export type UtmKey = (typeof UTM_KEYS)[number];

/** I tracker di un link, nella forma in cui li maneggia il codice. */
export interface TrackingParams {
  /** Chi manda il traffico: `facebook`, `newsletter`, `instagram`. */
  source?: string | null;
  /** Attraverso quale canale: `group`, `email`, `bio`, `share`. */
  medium?: string | null;
  /** Quale iniziativa: lo slug del gruppo, della campagna, dell'articolo. */
  campaign?: string | null;
  /** Quale variante del link, quando lo stesso link esiste in più punti. */
  content?: string | null;
  /** Keyword, solo per le campagne a pagamento. */
  term?: string | null;
}

/** Come i parametri arrivano dal database e dai report. */
export interface AttributionFacts extends TrackingParams {
  /** Host del referrer, quando c'era: `google.com`, `l.facebook.com`. */
  referrerHost?: string | null;
}

/** Sorgente usata quando non c'è alcun segnale: nessun referrer, nessun UTM. */
export const DIRECT_SOURCE = "direct";
/** Medium usato per il traffico diretto e per i segnali non classificabili. */
export const DIRECT_MEDIUM = "none";

/**
 * Valore normalizzato: minuscolo, senza accenti, spazi e punteggiatura ridotti
 * a trattini. È la forma in cui il valore finisce sia nell'URL sia nel
 * database, così il raggruppamento nei report non ha bisogno di pulizie.
 */
export function normalizeTrackingToken(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Normalizza tutti i campi e scarta quelli rimasti vuoti. */
export function normalizeTracking(tracking: TrackingParams | null | undefined): TrackingParams {
  if (!tracking) return {};
  const out: TrackingParams = {};
  const source = normalizeTrackingToken(tracking.source);
  const medium = normalizeTrackingToken(tracking.medium);
  const campaign = normalizeTrackingToken(tracking.campaign);
  const content = normalizeTrackingToken(tracking.content);
  const term = normalizeTrackingToken(tracking.term);
  if (source) out.source = source;
  if (medium) out.medium = medium;
  if (campaign) out.campaign = campaign;
  if (content) out.content = content;
  if (term) out.term = term;
  return out;
}

/** True quando non c'è nessun tracker da scrivere. */
export function isEmptyTracking(tracking: TrackingParams | null | undefined): boolean {
  const t = normalizeTracking(tracking);
  return !t.source && !t.medium && !t.campaign && !t.content && !t.term;
}

const KEY_BY_FIELD: Record<keyof TrackingParams, UtmKey> = {
  source: "utm_source",
  medium: "utm_medium",
  campaign: "utm_campaign",
  content: "utm_content",
  term: "utm_term",
};

/**
 * Aggiunge i tracker a un URL, sovrascrivendo quelli eventualmente già
 * presenti e lasciando intatto tutto il resto (path, hash, altri parametri).
 *
 * Senza tracker restituisce l'URL immutato: chi chiama può passare sempre,
 * senza distinguere il caso "link nudo". Su un URL non parsabile restituisce
 * l'originale, perché un tracker non vale la rottura di un link.
 */
export function buildTrackedUrl(url: string, tracking?: TrackingParams | null): string {
  if (!url) return url;
  const normalized = normalizeTracking(tracking);
  if (isEmptyTracking(normalized)) return url;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }

  for (const field of Object.keys(KEY_BY_FIELD) as (keyof TrackingParams)[]) {
    const value = normalized[field];
    const key = KEY_BY_FIELD[field];
    if (value) parsed.searchParams.set(key, value);
  }

  return parsed.toString();
}

/** Rimuove i parametri di tracking da un URL: l'indirizzo canonico da mostrare. */
export function stripTrackingFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    for (const key of UTM_KEYS) parsed.searchParams.delete(key);
    for (const key of Object.keys(CLICK_ID_SOURCES)) parsed.searchParams.delete(key);
    return parsed.toString();
  } catch {
    return url;
  }
}

/** Legge i tracker da una query string (o da un `URLSearchParams` già pronto). */
export function parseTrackingParams(search: string | URLSearchParams): TrackingParams {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  return normalizeTracking({
    source: params.get("utm_source"),
    medium: params.get("utm_medium"),
    campaign: params.get("utm_campaign"),
    content: params.get("utm_content"),
    term: params.get("utm_term"),
  });
}

/**
 * I click id che le piattaforme appendono da sole ai link: arrivano anche
 * quando il link non è stato taggato da noi, e sono l'unica prova che quel
 * traffico viene da lì. Valgono meno di un UTM esplicito, più del referrer.
 */
export const CLICK_ID_SOURCES: Record<string, { source: string; medium: string }> = {
  fbclid: { source: "facebook", medium: "social" },
  igshid: { source: "instagram", medium: "social" },
  gclid: { source: "google", medium: "cpc" },
  gbraid: { source: "google", medium: "cpc" },
  wbraid: { source: "google", medium: "cpc" },
  msclkid: { source: "bing", medium: "cpc" },
  ttclid: { source: "tiktok", medium: "social" },
  twclid: { source: "twitter", medium: "social" },
  li_fat_id: { source: "linkedin", medium: "social" },
};

/** Legge un eventuale click id di piattaforma dalla query string. */
export function parseClickIdSource(search: string | URLSearchParams): TrackingParams | null {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  for (const [param, attribution] of Object.entries(CLICK_ID_SOURCES)) {
    if (params.has(param)) return { ...attribution };
  }
  return null;
}

/**
 * Da host del referrer a sorgente. L'elenco copre i domini da cui il sito
 * riceve traffico davvero; tutto il resto resta classificato come `referral`
 * conservando l'host, che è comunque più informativo di "sconosciuto".
 */
const REFERRER_RULES: Array<{ match: RegExp; source: string; medium: string }> = [
  { match: /(^|\.)google\./, source: "google", medium: "organic" },
  { match: /(^|\.)bing\.com$/, source: "bing", medium: "organic" },
  { match: /(^|\.)duckduckgo\.com$/, source: "duckduckgo", medium: "organic" },
  { match: /(^|\.)ecosia\.org$/, source: "ecosia", medium: "organic" },
  { match: /(^|\.)yahoo\./, source: "yahoo", medium: "organic" },
  { match: /(^|\.)facebook\.com$/, source: "facebook", medium: "social" },
  { match: /(^|\.)fb\.(com|me)$/, source: "facebook", medium: "social" },
  { match: /(^|\.)instagram\.com$/, source: "instagram", medium: "social" },
  { match: /(^|\.)threads\.(net|com)$/, source: "threads", medium: "social" },
  { match: /(^|\.)(twitter\.com|x\.com|t\.co)$/, source: "twitter", medium: "social" },
  { match: /(^|\.)linkedin\.com$/, source: "linkedin", medium: "social" },
  { match: /(^|\.)lnkd\.in$/, source: "linkedin", medium: "social" },
  { match: /(^|\.)reddit\.com$/, source: "reddit", medium: "social" },
  { match: /(^|\.)youtube\.com$/, source: "youtube", medium: "social" },
  { match: /(^|\.)pinterest\./, source: "pinterest", medium: "social" },
  { match: /(^|\.)tiktok\.com$/, source: "tiktok", medium: "social" },
  { match: /(^|\.)(whatsapp\.com|wa\.me)$/, source: "whatsapp", medium: "chat" },
  { match: /(^|\.)(telegram\.org|t\.me)$/, source: "telegram", medium: "chat" },
  { match: /(^|\.)messenger\.com$/, source: "messenger", medium: "chat" },
  { match: /(^|\.)(mail\.google\.com|outlook\.(com|live\.com)|mail\.yahoo\.com)$/, source: "webmail", medium: "email" },
  { match: /(^|\.)chatgpt\.com$/, source: "chatgpt", medium: "ai" },
  { match: /(^|\.)openai\.com$/, source: "chatgpt", medium: "ai" },
  { match: /(^|\.)claude\.ai$/, source: "claude", medium: "ai" },
  { match: /(^|\.)perplexity\.ai$/, source: "perplexity", medium: "ai" },
  { match: /(^|\.)gemini\.google\.com$/, source: "gemini", medium: "ai" },
];

/** L'host di un URL, in minuscolo e senza `www.`. Stringa vuota se illeggibile. */
export function hostOf(url: string | null | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Classifica un referrer. Restituisce `null` quando il referrer è interno o
 * assente: in quel caso non c'è niente da attribuire e chi chiama deve tenersi
 * l'attribuzione che aveva già.
 */
export function classifyReferrer(
  referrer: string | null | undefined,
  selfHost?: string | null,
): (TrackingParams & { referrerHost: string }) | null {
  const host = hostOf(referrer);
  if (!host) return null;

  const self = (selfHost || "").toLowerCase().replace(/^www\./, "");
  // Stesso sito o sottodominio del sito: navigazione interna, non una sorgente.
  if (self && (host === self || host.endsWith(`.${self}`) || self.endsWith(`.${host}`))) return null;

  for (const rule of REFERRER_RULES) {
    if (rule.match.test(host)) {
      return { source: rule.source, medium: rule.medium, referrerHost: host };
    }
  }

  return { source: normalizeTrackingToken(host), medium: "referral", referrerHost: host };
}

/**
 * L'attribuzione di un atterraggio, dal segnale più forte al più debole:
 * UTM espliciti → click id di piattaforma → referrer → diretto.
 *
 * Non mescola i livelli: se c'è `utm_source` vince quello, anche quando il
 * referrer dice altro (è il caso normale di un link nostro condiviso in un
 * gruppo, dove il referrer è il redirect della piattaforma).
 */
export function resolveAttribution(input: {
  /** URL completo dell'atterraggio (`location.href`). */
  href: string;
  /** `document.referrer`, se c'è. */
  referrer?: string | null;
  /** Host del sito, per riconoscere la navigazione interna. */
  selfHost?: string | null;
}): AttributionFacts {
  let search = "";
  try {
    search = new URL(input.href).search;
  } catch {
    search = "";
  }

  const referrerInfo = classifyReferrer(input.referrer, input.selfHost);
  const referrerHost = referrerInfo?.referrerHost ?? hostOf(input.referrer) ?? "";

  const explicit = parseTrackingParams(search);
  if (explicit.source || explicit.campaign || explicit.medium) {
    return {
      source: explicit.source || referrerInfo?.source || DIRECT_SOURCE,
      medium: explicit.medium || referrerInfo?.medium || DIRECT_MEDIUM,
      campaign: explicit.campaign,
      content: explicit.content,
      term: explicit.term,
      referrerHost: referrerHost || null,
    };
  }

  const clickId = parseClickIdSource(search);
  if (clickId) {
    return { ...clickId, referrerHost: referrerHost || null };
  }

  if (referrerInfo) {
    return {
      source: referrerInfo.source,
      medium: referrerInfo.medium,
      referrerHost: referrerInfo.referrerHost,
    };
  }

  return { source: DIRECT_SOURCE, medium: DIRECT_MEDIUM, referrerHost: null };
}

/**
 * I canali che usiamo davvero, con l'etichetta con cui compaiono in admin.
 * È l'elenco che alimenta le tendine del generatore di link: scegliere da qui
 * invece di digitare è ciò che tiene pulito il vocabolario.
 */
export interface TrackingChannel {
  id: string;
  label: string;
  source: string;
  medium: string;
  /** Cosa ci si mette dentro, per chi genera il link mesi dopo. */
  hint?: string;
}

export const TRACKING_CHANNELS: TrackingChannel[] = [
  { id: "facebook-group", label: "Gruppo Facebook", source: "facebook", medium: "group", hint: "Campagna = nome del gruppo" },
  { id: "facebook-page", label: "Pagina Facebook", source: "facebook", medium: "page" },
  { id: "instagram-bio", label: "Instagram · bio", source: "instagram", medium: "bio" },
  { id: "instagram-story", label: "Instagram · storia", source: "instagram", medium: "story" },
  { id: "instagram-post", label: "Instagram · post", source: "instagram", medium: "post" },
  { id: "newsletter", label: "Newsletter", source: "newsletter", medium: "email", hint: "Campagna = slug della campagna" },
  { id: "whatsapp", label: "WhatsApp", source: "whatsapp", medium: "chat" },
  { id: "telegram", label: "Telegram", source: "telegram", medium: "chat" },
  { id: "linkedin", label: "LinkedIn", source: "linkedin", medium: "social" },
  { id: "reddit", label: "Reddit", source: "reddit", medium: "social" },
  { id: "youtube", label: "YouTube", source: "youtube", medium: "video" },
  { id: "forum", label: "Forum / community", source: "forum", medium: "referral", hint: "Campagna = nome del forum" },
  { id: "qr", label: "QR code / stampa", source: "qr", medium: "offline", hint: "Campagna = dove è affisso" },
  { id: "partner", label: "Partner / collaborazione", source: "partner", medium: "referral" },
  { id: "press", label: "Stampa", source: "press", medium: "referral" },
];

/** Il canale con cui si taggano i link che escono dal tasto Condividi. */
export const READER_SHARE_SOURCE = "share";

/**
 * Etichetta leggibile di una sorgente. Serve ai report: `direct` va scritto
 * "Diretto", non lasciato in inglese in mezzo a una tabella italiana.
 */
const SOURCE_LABELS: Record<string, string> = {
  direct: "Diretto",
  share: "Condivisioni lettori",
  newsletter: "Newsletter",
  facebook: "Facebook",
  instagram: "Instagram",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  google: "Google",
  bing: "Bing",
  duckduckgo: "DuckDuckGo",
  ecosia: "Ecosia",
  linkedin: "LinkedIn",
  reddit: "Reddit",
  youtube: "YouTube",
  tiktok: "TikTok",
  twitter: "X / Twitter",
  threads: "Threads",
  pinterest: "Pinterest",
  messenger: "Messenger",
  webmail: "Webmail",
  chatgpt: "ChatGPT",
  claude: "Claude",
  perplexity: "Perplexity",
  gemini: "Gemini",
  qr: "QR / stampa",
  partner: "Partner",
  press: "Stampa",
  forum: "Forum",
};

const MEDIUM_LABELS: Record<string, string> = {
  none: "—",
  group: "gruppo",
  page: "pagina",
  bio: "bio",
  story: "storia",
  post: "post",
  email: "email",
  chat: "chat",
  social: "social",
  organic: "ricerca organica",
  cpc: "annunci",
  referral: "referral",
  share: "condivisione",
  video: "video",
  offline: "offline",
  ai: "assistenti AI",
};

export function sourceLabel(source: string | null | undefined): string {
  const key = normalizeTrackingToken(source);
  if (!key) return "Sconosciuta";
  return SOURCE_LABELS[key] ?? key;
}

export function mediumLabel(medium: string | null | undefined): string {
  const key = normalizeTrackingToken(medium);
  if (!key) return "—";
  return MEDIUM_LABELS[key] ?? key;
}

/**
 * Campagna ricavata dall'indirizzo: l'ultimo segmento del path, che per gli
 * articoli è lo slug. Serve a taggare un link senza chiedere a chi condivide
 * di inventarsi un nome di campagna.
 */
export function campaignFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, "");
    const last = path.split("/").filter(Boolean).pop() ?? "";
    return normalizeTrackingToken(decodeURIComponent(last));
  } catch {
    return "";
  }
}
