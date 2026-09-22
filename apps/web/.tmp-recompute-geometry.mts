import { createClient } from "@supabase/supabase-js";
import { buildVoyageGeometry } from "@/lib/voyage-utils";

const SUPABASE_URL = "https://ekwloweuicrqjjgabfdp.supabase.co";
const SUPABASE_KEY = "sb_publishable_UrMKrI5OhEVGQJ4IvILc_g_1qUJ3bxa";
const VOYAGE_ID = "c421e207-86d0-42e9-be1c-6b7abb3e6c89";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const { data: voyage, error: voyageError } = await supabase
  .from("voyages")
  .select("type, waterway_autoroute")
  .eq("id", VOYAGE_ID)
  .single();
if (voyageError || !voyage) throw voyageError || new Error("voyage not found");

const { data: waypoints, error: waypointsError } = await supabase
  .from("voyage_waypoints")
  .select("lat, lng, actual_status")
  .eq("voyage_id", VOYAGE_ID)
  .order("sort_order", { ascending: true });
if (waypointsError || !waypoints) throw waypointsError || new Error("no waypoints");

const actualWaypoints = waypoints.filter((w: any) => w.actual_status !== "skipped");
process.stderr.write(`actual waypoints: ${actualWaypoints.length} / ${waypoints.length}\n`);

const voyageType = voyage.type as "water" | "land";
const coordinates = await buildVoyageGeometry(actualWaypoints as any, voyageType, {
  waterwayAutoroute: voyageType === "water" && Boolean((voyage as any).waterway_autoroute),
});

process.stderr.write(`coordinates: ${coordinates.length}\n`);
console.log(JSON.stringify(coordinates));
