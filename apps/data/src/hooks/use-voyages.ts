import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface Voyage {
  id: string;
  name: string;
  name_en: string | null;
  name_it: string | null;
  description: string | null;
  description_en: string | null;
  description_it: string | null;
  start_date: string | null;
  end_date: string | null;
  status: "planned" | "active" | "completed";
  type: "water" | "land";
  cached_geometry: unknown;
  is_published: boolean;
  sort_order: number;
}

export interface VoyageWaypoint {
  id: string;
  voyage_id: string;
  lat: number;
  lng: number;
  name: string | null;
  name_en: string | null;
  waypoint_type: string;
  sort_order: number;
  visibility_mode: string;
  date_start: string | null;
  date_end: string | null;
}

export interface RouteLeg {
  id: string;
  name: string;
  description: string | null;
  lat_start: number | null;
  lng_start: number | null;
  lat_end: number | null;
  lng_end: number | null;
  nautical_miles: number | null;
  status: string;
  sort_order: number;
  started_at: string | null;
  completed_at: string | null;
}

export const useVoyages = () =>
  useQuery({
    queryKey: ["voyages"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("voyages")
        .select("*")
        .eq("is_published", true)
        .order("sort_order");
      if (error) throw error;
      return (data || []) as Voyage[];
    },
  });

export const useVoyageWaypoints = (voyageId?: string) =>
  useQuery({
    queryKey: ["voyage_waypoints", voyageId],
    queryFn: async () => {
      let query = supabase
        .from("voyage_waypoints")
        .select("*")
        .order("sort_order");
      if (voyageId) query = query.eq("voyage_id", voyageId);
      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as VoyageWaypoint[];
    },
    enabled: voyageId !== "",
  });

export const useAllWaypoints = () =>
  useQuery({
    queryKey: ["all_waypoints"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("voyage_waypoints")
        .select("*")
        .order("sort_order");
      if (error) throw error;
      return (data || []) as VoyageWaypoint[];
    },
  });

export const useRouteLegs = () =>
  useQuery({
    queryKey: ["route_legs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("route_legs")
        .select("*")
        .order("sort_order");
      if (error) throw error;
      return (data || []) as RouteLeg[];
    },
  });

export const formatDateRange = (start: string | null, end: string | null) => {
  if (!start) return "TBD";
  const fmt = (d: string) => {
    const date = new Date(d);
    return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  };
  if (!end) return fmt(start);
  return `${fmt(start)} – ${fmt(end)}`;
};
