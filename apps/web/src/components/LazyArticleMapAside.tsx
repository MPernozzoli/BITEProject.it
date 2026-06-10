import { lazy, Suspense } from "react";
import type { ComponentProps } from "react";
import { useEffect } from "react";
import MapLoadingPlaceholder from "@/components/MapLoadingPlaceholder";
import { useI18n } from "@/lib/i18n";

let articleMapAsideImportPromise: Promise<typeof import("@/components/ArticleMapAside")> | null = null;

const loadArticleMapAside = () => {
  articleMapAsideImportPromise ??= import("@/components/ArticleMapAside");
  return articleMapAsideImportPromise;
};

const ArticleMapAside = lazy(loadArticleMapAside);

type LazyArticleMapAsideProps = ComponentProps<typeof ArticleMapAside>;

const LazyArticleMapAside = (props: LazyArticleMapAsideProps) => {
  const { lang } = useI18n();

  useEffect(() => {
    void loadArticleMapAside();
  }, []);

  return (
    <Suspense
      fallback={
        <div className="glass-panel rounded-[28px] overflow-hidden">
          <div className="relative h-[320px] w-full">
            <MapLoadingPlaceholder
              label={lang === "it" ? "Caricamento minimappa" : "Loading minimap"}
              className="bg-[radial-gradient(circle_at_top_left,rgba(159,207,214,0.18)_0%,transparent_55%)]"
            />
          </div>
        </div>
      }
    >
      <ArticleMapAside {...props} />
    </Suspense>
  );
};

export default LazyArticleMapAside;
