import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchPublicContentSnapshot,
  fetchPublicContentVersion,
  isPublicContentVersionEqual,
  type PublicContentSnapshot,
  type PublicContentVersion,
} from "@/lib/public-content";

const PUBLIC_CONTENT_STALE_MS = 1000 * 60 * 15;
const PUBLIC_CONTENT_CACHE_MS = 1000 * 60 * 60 * 24;
const PUBLIC_CONTENT_VERSION_STALE_MS = 1000 * 60 * 5;
const PUBLIC_CONTENT_VERSION_POLL_MS = 1000 * 60 * 10;

export function usePublicContentSnapshot() {
  const queryClient = useQueryClient();

  const snapshotQuery = useQuery<PublicContentSnapshot>({
    queryKey: ["public-content-snapshot"],
    queryFn: fetchPublicContentSnapshot,
    staleTime: PUBLIC_CONTENT_STALE_MS,
    gcTime: PUBLIC_CONTENT_CACHE_MS,
    retry: 1,
    meta: {
      persist: true,
    },
  });

  const versionQuery = useQuery<PublicContentVersion>({
    queryKey: ["public-content-version"],
    queryFn: fetchPublicContentVersion,
    enabled: Boolean(snapshotQuery.data),
    staleTime: PUBLIC_CONTENT_VERSION_STALE_MS,
    gcTime: PUBLIC_CONTENT_CACHE_MS,
    retry: 1,
    refetchOnWindowFocus: true,
    refetchInterval: PUBLIC_CONTENT_VERSION_POLL_MS,
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    if (!snapshotQuery.data?.version || !versionQuery.data) return;
    if (snapshotQuery.isFetching) return;

    if (isPublicContentVersionEqual(snapshotQuery.data.version, versionQuery.data)) {
      return;
    }

    void queryClient.invalidateQueries({ queryKey: ["public-content-snapshot"] });
  }, [queryClient, snapshotQuery.data, snapshotQuery.isFetching, versionQuery.data]);

  return snapshotQuery;
}
