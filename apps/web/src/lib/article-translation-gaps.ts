/** Allineato alla logica della Edge Function translate-editor-content (corpo vuoto/pieno). */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function isTiptapEffectivelyEmpty(doc: unknown): boolean {
  if (!isRecord(doc) || doc.type !== "doc") return true;
  const content = doc.content;
  if (!Array.isArray(content) || content.length === 0) return true;
  for (const node of content) {
    if (!isRecord(node)) return false;
    if (node.type === "paragraph") {
      const c = node.content;
      if (!Array.isArray(c)) continue;
      for (const inline of c) {
        if (isRecord(inline) && typeof inline.text === "string" && inline.text.trim()) return false;
      }
      continue;
    }
    return false;
  }
  return true;
}

const nonEmpty = (s: string) => s.trim().length > 0;

export type ArticleTranslationGaps = {
  hasGaps: boolean;
  /** Righe per UI (italiano) */
  labels: string[];
};

/**
 * True se almeno un campo ha contenuto in una lingua e manca nell’altra (come la traduzione automatica).
 */
export function getArticleTranslationGaps(input: {
  titleEn: string;
  titleIt: string;
  excerptEn: string;
  excerptIt: string;
  contentEn: unknown;
  contentIt: unknown;
}): ArticleTranslationGaps {
  const labels: string[] = [];

  const te = nonEmpty(input.titleEn);
  const ti = nonEmpty(input.titleIt);
  if (te !== ti && (te || ti)) {
    labels.push("Titolo: presente solo in una lingua");
  }

  const ee = nonEmpty(input.excerptEn);
  const ei = nonEmpty(input.excerptIt);
  if (ee !== ei && (ee || ei)) {
    labels.push("Estratto / sinossi: presente solo in una lingua");
  }

  const enBody = !isTiptapEffectivelyEmpty(input.contentEn);
  const itBody = !isTiptapEffectivelyEmpty(input.contentIt);
  if (enBody !== itBody && (enBody || itBody)) {
    labels.push("Corpo articolo: presente solo in una lingua");
  }

  return { hasGaps: labels.length > 0, labels };
}
