import { lazy, Suspense } from "react";
import type { ComponentProps } from "react";
import MapLoadingPlaceholder from "@/components/MapLoadingPlaceholder";
import { useI18n } from "@/lib/i18n";

const ArticleMapAside = lazy(() => import("@/components/ArticleMapAside"));

type LazyArticleMapAsideProps = ComponentProps<typeof ArticleMapAside>;

const LazyArticleMapAside = (props: LazyArticleMapAsideProps) => {
  const { lang } = useI18n();

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
