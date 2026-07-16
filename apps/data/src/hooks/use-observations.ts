import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ObservationParameter {
  code: string;
  unit_code: string;
  label_en: string;
  label_it: string | null;
  unit: string;
  description_en: string | null;
  limitations_en: string | null;
  accuracy: string | null;
  value_type: "numeric" | "categorical";
  scale_min: number | null;
  scale_max: number | null;
  color_ramp: "sequential" | "cyclic";
  sort_order: number;
}

export interface ObservationReading {
  value: number | null;
  text: string | null;
  qc: number;
}

export interface Observation {
  id: string;
  voyage_id: string | null;
  recorded_at: string;
  lat: number;
  lng: number;
  depth_m: number | null;
  gps_accuracy_m: number | null;
  source: "sensor" | "manual" | "simulated";
  qc_flag: number;
  notes: string | null;
  device_code: string | null;
  device_label: string | null;
  measurements: Record<string, ObservationReading>;
}

export const useObservationParameters = () =>
  useQuery({
    queryKey: ["observation_parameters"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("observation_parameters")
        .select("*")
        .order("sort_order");
      if (error) throw error;
      return (data || []) as unknown as ObservationParameter[];
    },
    staleTime: 60 * 60 * 1000,
  });

const PAGE_SIZE = 1000;

/** Published point count per voyage. `head: true` returns the count without the rows. */
export const useObservationCounts = (voyageIds: string[]) =>
  useQuery({
    queryKey: ["observation_counts", [...voyageIds].sort()],
    queryFn: async () => {
      const entries = await Promise.all(
        voyageIds.map(async (id) => {
          const { count, error } = await supabase
            .from("observations")
            .select("*", { count: "exact", head: true })
            .eq("voyage_id", id);
          if (error) throw error;
          return [id, count ?? 0] as const;
        }),
      );
      return new Map(entries);
    },
    enabled: voyageIds.length > 0,
  });

/**
 * The analysis-ready wide table: one row per point, one column per parameter. Fetched on
 * demand rather than on page load — this is the download payload, not page content.
 */
export const fetchObservationExport = async (voyageId?: string) => {
  const all: Record<string, unknown>[] = [];
  for (let page = 0; ; page += 1) {
    let query = supabase
      .from("observations_export")
      .select("*")
      .order("recorded_at_utc")
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (voyageId) query = query.eq("voyage_id", voyageId);
    const { data, error } = await query;
    if (error) throw error;
    const rows = (data || []) as Record<string, unknown>[];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return all;
};

export const useObservations = () =>
  useQuery({
    queryKey: ["observations_map"],
    queryFn: async () => {
      // PostgREST caps a response at db-max-rows, so walk the pages: the point cloud
      // grows by a few hundred rows per voyage and will pass any single-request cap.
      const all: Observation[] = [];
      for (let page = 0; ; page += 1) {
        const { data, error } = await supabase
          .from("observations_map")
          .select("*")
          .order("recorded_at")
          .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
        if (error) throw error;
        const rows = (data || []) as unknown as Observation[];
        all.push(...rows);
        if (rows.length < PAGE_SIZE) break;
      }
      return all;
    },
  });
