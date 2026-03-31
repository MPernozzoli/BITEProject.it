import { useQuery } from "@tanstack/react-query";
import { fetchPublicContentSnapshot, type PublicContentSnapshot } from "@/lib/public-content";

const PUBLIC_CONTENT_STALE_MS = 1000 * 60 * 15;
const PUBLIC_CONTENT_CACHE_MS = 1000 * 60 * 60 * 24;

export function usePublicContentSnapshot() {
  return useQuery<PublicContentSnapshot>({
    queryKey: ["public-content-snapshot"],
    queryFn: fetchPublicContentSnapshot,
    staleTime: PUBLIC_CONTENT_STALE_MS,
    gcTime: PUBLIC_CONTENT_CACHE_MS,
    retry: 1,
    meta: {
      persist: true,
    },
  });
}
