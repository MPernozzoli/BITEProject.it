import type { ComponentProps, Dispatch, SetStateAction } from "react";
import { X } from "lucide-react";
import ArticleReader from "@/components/ArticleReader";
import type { Language } from "@/lib/language";
import type { Voyage, VoyageWaypoint } from "@/lib/voyage-utils";

type ArticleReaderProps = ComponentProps<typeof ArticleReader>;

export interface ArticlePreviewOverlayProps {
  previewOpen: boolean;
  setPreviewOpen: Dispatch<SetStateAction<boolean>>;
  previewLang: Language;
  setPreviewLang: Dispatch<SetStateAction<Language>>;
  previewArticle: ArticleReaderProps["article"];
  previewAuthors: ArticleReaderProps["authors"];
  previewTags: ArticleReaderProps["tags"];
  previewStory: ArticleReaderProps["story"];
  selectedVoyage: Voyage | null;
  voyageWaypoints: VoyageWaypoint[];
  /** Serve solo a comporre lo shareUrl mostrato in anteprima. */
  slug: string;
}

const ArticlePreviewOverlay = ({
  previewOpen,
  setPreviewOpen,
  previewLang,
  setPreviewLang,
  previewArticle,
  previewAuthors,
  previewTags,
  previewStory,
  selectedVoyage,
  voyageWaypoints,
  slug,
}: ArticlePreviewOverlayProps) => {
  if (!previewOpen) return null;

  return (
      <div className="fixed inset-0 z-[80] bg-background">
        <div className="sticky top-0 z-20 border-b border-border bg-background/95 px-4 py-3 backdrop-blur md:px-6">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-sans uppercase tracking-[0.2em] text-muted-foreground">Anteprima articolo</p>
              <p className="text-sm font-sans text-foreground">
                {previewLang === "it" ? previewArticle.title_it : previewArticle.title_en}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="inline-flex overflow-hidden border border-border">
                <button
                  type="button"
                  onClick={() => setPreviewLang("it")}
                  className={`px-3 py-2 text-xs font-sans transition-colors ${previewLang === "it" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
                >
                  IT
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewLang("en")}
                  className={`px-3 py-2 text-xs font-sans transition-colors ${previewLang === "en" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
                >
                  EN
                </button>
              </div>
              <button
                type="button"
                onClick={() => setPreviewOpen(false)}
                className="inline-flex items-center gap-2 border border-border px-3 py-2 text-xs font-sans text-muted-foreground transition-colors hover:border-foreground hover:text-foreground"
              >
                <X size={14} /> Chiudi
              </button>
            </div>
          </div>
        </div>
        <div className="h-[calc(100vh-65px)] overflow-y-auto">
          <ArticleReader
            article={previewArticle as any}
            authors={previewAuthors}
            tags={previewTags}
            story={previewStory as any}
            linkedVoyage={selectedVoyage}
            linkedVoyageWaypoints={voyageWaypoints}
            lang={previewLang}
            previewMode
            previewLabel="Anteprima admin: i contenuti arrivano dalla bozza corrente e like/commenti non sono attivi."
            shareUrl={`${window.location.origin}/logbook/${encodeURIComponent(slug || "preview")}`}
          />
        </div>
      </div>
  );
};

export default ArticlePreviewOverlay;
