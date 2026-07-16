import type { Voyage } from "@/hooks/use-voyages";

const MAIN_SITE = "https://biteproject.it";

/** This portal is English-only, so it sends researchers to the English side of the site. */
const LANG = "en";

/**
 * Mirrors slugifyVoyageName() / buildVoyagePath() in apps/web/src/lib/voyage-utils.ts.
 * It is copied rather than imported because that module resolves `@/lib/i18n`, an alias
 * that points at apps/web in the main site and at apps/data here.
 *
 * Safe to copy: the main site reads back only the id before the `--`
 * (getVoyageIdFromRouteParam), so the slug is cosmetic. If the two ever drift, the link
 * still resolves to the right voyage.
 */
const slugifyVoyageName = (value: string): string =>
  value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "voyage";

const getVoyageSlugSource = (voyage: Pick<Voyage, "name" | "name_en" | "name_it">) =>
  voyage.name_en?.trim() || voyage.name_it?.trim() || voyage.name;

/** Absolute URL of a voyage's page on the main site — the way into the narrative. */
export const buildVoyageUrl = (
  voyage: Pick<Voyage, "id" | "name" | "name_en" | "name_it">,
): string =>
  `${MAIN_SITE}/${LANG}/voyages/${voyage.id}--${slugifyVoyageName(getVoyageSlugSource(voyage))}`;
