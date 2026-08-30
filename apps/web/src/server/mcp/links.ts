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
 */

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

function buildLinks(siteUrl: string, prefix: string, record: BilingualSlugs | null | undefined): PublicLinks {
  const base = (siteUrl || "").replace(/\/$/, "");
  const links: PublicLinks = { url_it: null, url_en: null };
  if (!base) return links;
  for (const lang of LINK_LANGS) {
    const slug = slugForLang(record, lang);
    if (!slug) continue;
    links[`url_${lang}`] = `${base}/${lang}${prefix}/${encodeURIComponent(slug)}`;
  }
  return links;
}

/** `https://biteproject.it/it/logbook/<slug>` e la sua controparte inglese. */
export function articleLinks(siteUrl: string, record: BilingualSlugs | null | undefined): PublicLinks {
  return buildLinks(siteUrl, "/logbook", record);
}
