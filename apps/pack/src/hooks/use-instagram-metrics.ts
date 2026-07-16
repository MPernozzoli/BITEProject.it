import { useEffect, useState } from "react";
import {
  currentLanguage,
  instagramProfile,
  languages,
  metrics as fallbackMetrics,
  publicMetricsMethodology,
  topCountries,
} from "@/data/site";
import { supabase } from "@/integrations/supabase/client";

export type MetricItem = {
  label: string;
  value: number;
  suffix: string;
};

export type AudienceItem = {
  label: string;
  value: number;
};

type SocialMetricsResponse = {
  metrics?: MetricItem[];
  topCountries?: AudienceItem[];
  audienceBreakdown?: AudienceItem[];
  updatedAt?: string;
  mediaKitUrl?: string;
  source?: string;
};

type InstagramMetricsState = {
  metrics: MetricItem[];
  topCountries: AudienceItem[];
  audienceBreakdown: AudienceItem[];
  updatedAt: string;
  isLive: boolean;
};

const fallbackState: InstagramMetricsState = {
  metrics: fallbackMetrics,
  topCountries,
  audienceBreakdown: languages,
  updatedAt: publicMetricsMethodology.capturedAt,
  isLive: false,
};

let cachedState: InstagramMetricsState | null = null;
let metricsRequest: Promise<InstagramMetricsState> | null = null;

const fetchInstagramMetrics = async (): Promise<InstagramMetricsState> => {
  if (cachedState) return cachedState;
  if (metricsRequest) return metricsRequest;

  metricsRequest = supabase.functions
    .invoke<SocialMetricsResponse>(instagramProfile.supabaseFunctionName, {
      body: {
        slug: instagramProfile.handle,
        mediaKitUrl: instagramProfile.mediaKitUrl,
        profileInfoUrl: instagramProfile.profileInfoUrl,
        language: currentLanguage,
      },
    })
    .then(({ data, error }) => {
      if (error) throw error;

      cachedState = {
        metrics: data?.metrics?.length ? data.metrics : fallbackMetrics,
        topCountries: data?.topCountries?.length ? data.topCountries : topCountries,
        audienceBreakdown: data?.audienceBreakdown?.length ? data.audienceBreakdown : languages,
        updatedAt: data?.updatedAt ?? publicMetricsMethodology.capturedAt,
        isLive: Boolean(data?.metrics?.length),
      };

      return cachedState;
    })
    .catch((error) => {
      metricsRequest = null;
      throw error;
    });

  return metricsRequest;
};

export const useInstagramMetrics = (): InstagramMetricsState => {
  const [state, setState] = useState<InstagramMetricsState>(cachedState ?? fallbackState);

  useEffect(() => {
    let cancelled = false;

    const loadMetrics = async () => {
      try {
        const nextState = await fetchInstagramMetrics();
        if (cancelled) return;
        setState(nextState);
      } catch (error) {
        console.warn("Unable to refresh metrics. Using embedded snapshot.", error);
      }
    };

    void loadMetrics();

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
};
