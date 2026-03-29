import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { ComponentProps } from "react";

const VoyageMap = lazy(() => import("@/components/voyage/VoyageMap"));

type LazyVoyageMapProps = ComponentProps<typeof VoyageMap> & {
  fallbackHeightClassName?: string;
  deferUntilVisible?: boolean;
};

const LazyVoyageMap = ({
  fallbackHeightClassName = "h-full min-h-[20rem]",
  deferUntilVisible = false,
  ...props
}: LazyVoyageMapProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [shouldRenderMap, setShouldRenderMap] = useState(!deferUntilVisible);

  useEffect(() => {
    if (!deferUntilVisible || shouldRenderMap || !containerRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldRenderMap(true);
          observer.disconnect();
        }
      },
      { rootMargin: "240px 0px" }
    );

    observer.observe(containerRef.current);

    return () => observer.disconnect();
  }, [deferUntilVisible, shouldRenderMap]);

  const fallback = (
    <div
      className={`w-full ${fallbackHeightClassName} bg-[linear-gradient(180deg,rgba(255,255,255,0.42),rgba(243,246,247,0.62))]`}
      aria-hidden
    />
  );

  return (
    <div ref={containerRef}>
      {!shouldRenderMap ? (
        fallback
      ) : (
        <Suspense fallback={fallback}>
          <VoyageMap {...props} />
        </Suspense>
      )}
    </div>
  );
};

export default LazyVoyageMap;
