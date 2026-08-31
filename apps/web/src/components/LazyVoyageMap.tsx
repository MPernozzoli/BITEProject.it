import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { ComponentProps } from "react";
import MapLoadingPlaceholder from "@/components/MapLoadingPlaceholder";

let voyageMapImportPromise: Promise<typeof import("@/components/voyage/VoyageMap")> | null = null;

const loadVoyageMap = () => {
  voyageMapImportPromise ??= import("@/components/voyage/VoyageMap");
  return voyageMapImportPromise;
};

const VoyageMap = lazy(loadVoyageMap);

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

  // Il chunk di maplibre pesa ~260 KB gzip: quando la mappa è sotto la piega
  // (deferUntilVisible) va scaricato solo se l'utente ci arriva davvero, non al
  // mount. Senza questa guardia il differimento riguarderebbe il solo rendering
  // e la rete pagherebbe comunque il prezzo pieno al primo paint.
  useEffect(() => {
    if (deferUntilVisible) return;
    void loadVoyageMap();
  }, [deferUntilVisible]);

  useEffect(() => {
    if (!deferUntilVisible || shouldRenderMap || !containerRef.current) return;
    if (typeof IntersectionObserver === "undefined") {
      void loadVoyageMap();
      setShouldRenderMap(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          // rootMargin anticipa di 240px: il download parte mentre la mappa è
          // ancora fuori schermo, così l'attesa resta invisibile.
          void loadVoyageMap();
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
    <div className="relative h-full w-full">
      <MapLoadingPlaceholder label={props.lang === "it" ? "Caricamento mappa" : "Loading map"} />
    </div>
  );

  return (
    <div ref={containerRef} className={`w-full ${fallbackHeightClassName}`}>
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
