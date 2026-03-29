import { lazy, Suspense } from "react";
import type { ComponentProps } from "react";

const VoyageMap = lazy(() => import("@/components/voyage/VoyageMap"));

type LazyVoyageMapProps = ComponentProps<typeof VoyageMap> & {
  fallbackHeightClassName?: string;
};

const LazyVoyageMap = ({ fallbackHeightClassName = "h-full min-h-[20rem]", ...props }: LazyVoyageMapProps) => {
  return (
    <Suspense
      fallback={
        <div
          className={`w-full ${fallbackHeightClassName} bg-[linear-gradient(180deg,rgba(255,255,255,0.42),rgba(243,246,247,0.62))]`}
          aria-hidden
        />
      }
    >
      <VoyageMap {...props} />
    </Suspense>
  );
};

export default LazyVoyageMap;
