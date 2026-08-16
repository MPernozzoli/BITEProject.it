import { useMemo } from "react";
import { Loader2, Sparkles } from "lucide-react";
import type { Database, Json } from "@/integrations/supabase/types";
import { useI18n } from "@/lib/i18n";

export type ArticleSeoOptimization = Database["public"]["Tables"]["article_seo_optimizations"]["Row"];
type SeoRecommendations = {
  contentGaps: string[];
  onPage: string[];
};

const getStringList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
};

const getSeoRecommendations = (value: Json | null | undefined): SeoRecommendations => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { contentGaps: [], onPage: [] };
  }

  return {
    contentGaps: getStringList(value.content_gaps),
    onPage: getStringList(value.on_page),
  };
};

const formatSeoDate = (value: string | null): string | null => {
  if (!value) return null;
  return new Intl.DateTimeFormat("it-IT", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
};

export interface ArticleSeoPanelProps {
  /** Id articolo dalla route (`undefined` o "new" per una bozza mai salvata). */
  id: string | undefined;
  seoOptimization: ArticleSeoOptimization | null;
  seoOptimizing: boolean;
  aiTranslating: boolean;
  saving: boolean;
  persistedArticleStatus: "draft" | "scheduled" | "published" | null;
  runSeoOptimization: (
    articleId?: string | null,
    options?: { accessToken?: string; background?: boolean; force?: boolean; quiet?: boolean },
  ) => Promise<boolean>;
}

const ArticleSeoPanel = ({
  id,
  seoOptimization,
  seoOptimizing,
  aiTranslating,
  saving,
  persistedArticleStatus,
  runSeoOptimization,
}: ArticleSeoPanelProps) => {
  const { t } = useI18n();
  const seoRecommendations = useMemo(
  () => getSeoRecommendations(seoOptimization?.recommendations),
  [seoOptimization?.recommendations]
  );
  const seoGeneratedAt = formatSeoDate(seoOptimization?.generated_at ?? null);
  const seoUpdatedAt = formatSeoDate(seoOptimization?.updated_at ?? null);
  const seoStatusMeta = useMemo(() => {
  switch (seoOptimization?.status) {
  case "ready":
  return {
  className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-100",
  label: "Pronta",
  };
  case "processing":
  return {
  className: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-100",
  label: "In generazione",
  };
  case "failed":
  return {
  className: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-100",
  label: "Da rivedere",
  };
  case "pending":
  return {
  className: "border-border bg-muted/40 text-muted-foreground",
  label: "In coda",
  };
  default:
  return {
  className: "border-border bg-muted/40 text-muted-foreground",
  label: persistedArticleStatus === "published" ? "Non generata" : "Non disponibile",
  };
  }
  }, [persistedArticleStatus, seoOptimization?.status]);

  return (
      <div className="rounded-[18px] border border-border/80 bg-muted/20 p-3">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground block">SEO IA</label>
            <p className="mt-1 text-[11px] font-sans text-muted-foreground">
              {seoGeneratedAt ? `Generata ${seoGeneratedAt}` : seoUpdatedAt ? `Aggiornata ${seoUpdatedAt}` : "Meta generati dopo la pubblicazione"}
            </p>
          </div>
          <span className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-sans font-medium ${seoStatusMeta.className}`}>
            {seoStatusMeta.label}
          </span>
        </div>

        {persistedArticleStatus !== "published" ? (
          <p className="text-xs font-sans leading-relaxed text-muted-foreground">
            La SEO automatica viene generata quando l'articolo viene pubblicato.
          </p>
        ) : !seoOptimization ? (
          <p className="text-xs font-sans leading-relaxed text-muted-foreground">
            Nessuna ottimizzazione SEO salvata. Usa il pulsante Ottimizza SEO per generarla manualmente.
          </p>
        ) : seoOptimization.status === "failed" ? (
          <div className="space-y-3">
            <p className="text-xs font-sans leading-relaxed text-amber-800 dark:text-amber-100">
              {seoOptimization.error_message || "La generazione SEO non è riuscita."}
            </p>
            <button
              type="button"
              onClick={() => void runSeoOptimization(id, { force: true })}
              disabled={saving || aiTranslating || seoOptimizing}
              className="inline-flex items-center gap-2 border border-amber-500/40 px-3 py-1.5 text-xs font-sans text-amber-800 transition-colors hover:border-amber-600 hover:text-foreground disabled:opacity-50 dark:text-amber-100"
            >
              {seoOptimizing ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
              Riprova
            </button>
          </div>
        ) : seoOptimization.status === "processing" || seoOptimization.status === "pending" ? (
          <p className="text-xs font-sans leading-relaxed text-muted-foreground">
            Generazione in corso. La card si aggiorna dopo il prossimo caricamento o dopo una rigenerazione manuale.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-[10px] font-sans uppercase tracking-[0.18em] text-muted-foreground">Italiano</p>
              <div>
                <p className="text-[10px] font-sans text-muted-foreground">Meta title</p>
                <p className="text-xs font-sans leading-snug text-foreground">{seoOptimization.title_it || "Non generato"}</p>
              </div>
              <div>
                <p className="text-[10px] font-sans text-muted-foreground">Meta description</p>
                <p className="text-xs font-sans leading-relaxed text-foreground/80">{seoOptimization.description_it || "Non generata"}</p>
              </div>
              {seoOptimization.keywords_it.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {seoOptimization.keywords_it.map((keyword) => (
                    <span key={`it-${keyword}`} className="rounded-full border border-border bg-background/70 px-2 py-0.5 text-[10px] font-sans text-muted-foreground">
                      {keyword}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2 border-t border-border/70 pt-3">
              <p className="text-[10px] font-sans uppercase tracking-[0.18em] text-muted-foreground">English</p>
              <div>
                <p className="text-[10px] font-sans text-muted-foreground">Meta title</p>
                <p className="text-xs font-sans leading-snug text-foreground">{seoOptimization.title_en || "Not generated"}</p>
              </div>
              <div>
                <p className="text-[10px] font-sans text-muted-foreground">Meta description</p>
                <p className="text-xs font-sans leading-relaxed text-foreground/80">{seoOptimization.description_en || "Not generated"}</p>
              </div>
              {seoOptimization.keywords_en.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {seoOptimization.keywords_en.map((keyword) => (
                    <span key={`en-${keyword}`} className="rounded-full border border-border bg-background/70 px-2 py-0.5 text-[10px] font-sans text-muted-foreground">
                      {keyword}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <details className="border-t border-border/70 pt-3">
              <summary className="cursor-pointer text-xs font-sans text-muted-foreground hover:text-foreground">Social, alt e suggerimenti</summary>
              <div className="mt-3 space-y-3">
                <div>
                  <p className="text-[10px] font-sans text-muted-foreground">Social title IT / EN</p>
                  <p className="text-xs font-sans text-foreground/80">{seoOptimization.social_title_it || "Non generato"}</p>
                  <p className="text-xs font-sans text-foreground/80">{seoOptimization.social_title_en || "Not generated"}</p>
                </div>
                <div>
                  <p className="text-[10px] font-sans text-muted-foreground">Alt cover IT / EN</p>
                  <p className="text-xs font-sans text-foreground/80">{seoOptimization.image_alt_it || "Non generato"}</p>
                  <p className="text-xs font-sans text-foreground/80">{seoOptimization.image_alt_en || "Not generated"}</p>
                </div>
                {(seoRecommendations.onPage.length > 0 || seoRecommendations.contentGaps.length > 0) && (
                  <div className="space-y-2">
                    {seoRecommendations.onPage.length > 0 && (
                      <div>
                        <p className="text-[10px] font-sans text-muted-foreground">On page</p>
                        <ul className="list-disc space-y-1 pl-4 text-xs font-sans text-foreground/80">
                          {seoRecommendations.onPage.map((item) => <li key={`on-${item}`}>{item}</li>)}
                        </ul>
                      </div>
                    )}
                    {seoRecommendations.contentGaps.length > 0 && (
                      <div>
                        <p className="text-[10px] font-sans text-muted-foreground">Content gap</p>
                        <ul className="list-disc space-y-1 pl-4 text-xs font-sans text-foreground/80">
                          {seoRecommendations.contentGaps.map((item) => <li key={`gap-${item}`}>{item}</li>)}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
                {seoOptimization.model && (
                  <p className="text-[10px] font-sans text-muted-foreground">Modello: {seoOptimization.model}</p>
                )}
              </div>
            </details>
          </div>
        )}
      </div>
  );
};

export default ArticleSeoPanel;
