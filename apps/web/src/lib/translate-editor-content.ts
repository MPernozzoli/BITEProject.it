import { supabase } from "@/integrations/supabase/client";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export type TranslateEditorWaypointBody = {
  kind: "waypoint";
  name_it: string;
  name_en: string;
  description_it: string;
  description_en: string;
};

export type TranslateEditorArticleBody = {
  kind: "article";
  title_en: string;
  title_it: string;
  excerpt_en: string;
  excerpt_it: string;
  content_en: unknown;
  content_it: unknown;
};

export async function invokeTranslateEditorContent(
  body: TranslateEditorWaypointBody | TranslateEditorArticleBody
): Promise<
  | { ok: true; fields: Record<string, unknown>; skipped?: string }
  | { ok: false; error: string }
> {
  const { data, error } = await supabase.functions.invoke("translate-editor-content", { body });

  if (error) {
    return { ok: false, error: error.message || "Richiesta fallita" };
  }

  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (typeof d.error === "string") {
      return { ok: false, error: d.error };
    }
    if (d.skipped === "nothing_to_translate") {
      return { ok: true, fields: {}, skipped: "nothing_to_translate" };
    }
    if (d.ok === true && isRecord(d.fields)) {
      return { ok: true, fields: d.fields };
    }
  }

  return { ok: false, error: "Risposta non prevista dal server" };
}
