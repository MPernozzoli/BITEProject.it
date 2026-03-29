import { lazy, Suspense } from "react";
import type { ComponentProps } from "react";

const ArticleMapAside = lazy(() => import("@/components/ArticleMapAside"));

type LazyArticleMapAsideProps = ComponentProps<typeof ArticleMapAside>;

const LazyArticleMapAside = (props: LazyArticleMapAsideProps) => {
  return (
    <Suspense
      fallback={
        <div className="glass-panel rounded-[28px] overflow-hidden">
          <div className="h-[320px] w-full bg-[radial-gradient(circle_at_top_left,rgba(159,207,214,0.18)_0%,transparent_55%)]" />
        </div>
      }
    >
      <ArticleMapAside {...props} />
    </Suspense>
  );
};

export default LazyArticleMapAside;
