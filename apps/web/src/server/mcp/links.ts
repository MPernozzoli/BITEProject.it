/**
 * URL pubblici dei contenuti, per i tool MCP.
 *
 * Un agente che legge un articolo da qui deve poterlo anche linkare — in una
 * newsletter, in un post, in un'automazione — senza ricostruire a mano il
 * percorso dagli slug. La regola di scelta dello slug è la stessa di
 * `lib/article-slug.ts` (slug della lingua → slug dell'altra → slug legacy) e
 * il prefisso di lingua è lo stesso della sitemap pubblica
 * (`supabase/functions/public-sitemap`): riscritta qui perché il server non
 * importa codice del client, come già succede per `generateSlug`.
 *
 * Nessuno scope nuovo: i link accompagnano i dati che il tool restituisce già,
 * quindi chi può leggere un articolo può leggerne l'indirizzo.
 *
 * Gli URL possono essere generati **tracciati**: un agente che sta per
 * pubblicare in un gruppo Facebook non deve comporre a mano `?utm_source=...`,
 * lo chiede qui e il vocabolario resta quello di `lib/utm.ts` — lo stesso che
 * usano il tasto Condividi del sito e il generatore in admin.
 */
import { buildTrackedUrl, type TrackingParams } from "../../lib/utm.js";

export const LINK_LANGS = ["it", "en"] as const;

export type LinkLang = (typeof LINK_LANGS)[number];

/** Record con gli slug per lingua; `slug` è quello canonico/legacy. */
export interface BilingualSlugs {
  slug?: string | null;
  slug_it?: string | null;
  slug_en?: string | null;
}

/**
 * Gli URL definitivi del contenuto, uno per lingua. `null` quando manca del
 * tutto uno slug da cui costruirli.
 *
 * Sono gli indirizzi che il contenuto ha *una volta pubblicato*: su una bozza
 * puntano a una pagina che ancora non risponde.
 */
export interface PublicLinks {
  url_it: string | null;
  url_en: string | null;
}

function slugForLang(record: BilingualSlugs | null | undefined, lang: LinkLang): string {
  if (!record) return "";
  const own = lang === "it" ? record.slug_it : record.slug_en;
  if (own && own.trim()) return own.trim();
  const other = lang === "it" ? record.slug_en : record.slug_it;
  if (other && other.trim()) return other.trim();
  return (record.slug ?? "").trim();
}

function buildLinks(
  siteUrl: string,
  prefix: string,
  record: BilingualSlugs | null | undefined,
  tracking?: TrackingParams | null,
): PublicLinks {
  const base = (siteUrl || "").replace(/\/$/, "");
  const links: PublicLinks = { url_it: null, url_en: null };
  if (!base) return links;
  for (const lang of LINK_LANGS) {
    const slug = slugForLang(record, lang);
    if (!slug) continue;
    const url = `${base}/${lang}${prefix}/${encodeURIComponent(slug)}`;
    links[`url_${lang}`] = buildTrackedUrl(url, tracking);
  }
  return links;
}

/**
 * `https://biteproject.it/it/logbook/<slug>` e la sua controparte inglese.
 *
 * Con `tracking` gli stessi indirizzi tornano con i parametri `utm_*`: è la
 * forma da incollare in un post o in una newsletter. Senza, tornano nudi — che
 * resta la forma giusta per mostrarli, salvarli o confrontarli.
 */
export function articleLinks(
  siteUrl: string,
  record: BilingualSlugs | null | undefined,
  tracking?: TrackingParams | null,
): PublicLinks {
  return buildLinks(siteUrl, "/logbook", record, tracking);
}

/** `https://biteproject.it/it/logbook/story/<slug>` e la controparte inglese. */
export function storyLinks(
  siteUrl: string,
  record: BilingualSlugs | null | undefined,
  tracking?: TrackingParams | null,
): PublicLinks {
  return buildLinks(siteUrl, "/logbook/story", record, tracking);
}
