import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

// BITE Project (source) — publishable credentials
const BITE_URL = "https://vdflrzcmlipvtardannd.supabase.co";
const BITE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZkZmxyemNtbGlwdnRhcmRhbm5kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0NDA3MDksImV4cCI6MjA5MDAxNjcwOX0.wPZhb2YKT8LOoGe_JgUvEO-6eFIHedv90YJlnQCR508";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Verify caller is authorized (service role or cron)
    const authHeader = req.headers.get("Authorization");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!serviceKey) {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY not configured");
    }

    // Source client (BITE Project — read only with anon key)
    const biteClient = createClient(BITE_URL, BITE_ANON_KEY);

    // Destination client (this project — service role for writes)
    const localUrl = Deno.env.get("SUPABASE_URL")!;
    const localClient = createClient(localUrl, serviceKey);

    const now = new Date().toISOString();
    const results: Record<string, number> = {};

    // 1. Sync voyages (only published)
    const { data: voyages, error: voyagesErr } = await biteClient
      .from("voyages")
      .select("*")
      .eq("is_published", true);

    if (voyagesErr) throw new Error(`Failed to fetch voyages: ${voyagesErr.message}`);

    if (voyages && voyages.length > 0) {
      const rows = voyages.map((v: Record<string, unknown>) => ({
        id: v.id,
        name: v.name,
        name_en: v.name_en,
        name_it: v.name_it,
        description: v.description,
        description_en: v.description_en,
        description_it: v.description_it,
        start_date: v.start_date,
        start_time: v.start_time,
        end_date: v.end_date,
        end_time: v.end_time,
        status: v.status,
        type: v.type,
        cached_geometry: v.cached_geometry,
        is_published: v.is_published,
        sort_order: v.sort_order,
        synced_at: now,
      }));

      const { error: upsertErr } = await localClient
        .from("voyages")
        .upsert(rows, { onConflict: "id" });

      if (upsertErr) throw new Error(`Failed to upsert voyages: ${upsertErr.message}`);
      results.voyages = rows.length;
    }

    // 2. Sync voyage waypoints for synced voyages
    const voyageIds = (voyages || []).map((v: Record<string, unknown>) => v.id as string);

    if (voyageIds.length > 0) {
      const { data: waypoints, error: wpErr } = await biteClient
        .from("voyage_waypoints")
        .select("*")
        .in("voyage_id", voyageIds);

      if (wpErr) throw new Error(`Failed to fetch waypoints: ${wpErr.message}`);

      if (waypoints && waypoints.length > 0) {
        const wpRows = waypoints.map((w: Record<string, unknown>) => ({
          id: w.id,
          voyage_id: w.voyage_id,
          lat: w.lat,
          lng: w.lng,
          name: w.name,
          name_en: w.name_en,
          name_it: w.name_it,
          description_en: w.description_en,
          description_it: w.description_it,
          waypoint_type: w.waypoint_type,
          sort_order: w.sort_order,
          visibility_mode: w.visibility_mode,
          media: w.media,
          date_start: w.date_start,
          date_end: w.date_end,
          event_date: w.event_date,
          event_time: w.event_time,
          synced_at: now,
        }));

        const { error: upsertErr } = await localClient
          .from("voyage_waypoints")
          .upsert(wpRows, { onConflict: "id" });

        if (upsertErr) throw new Error(`Failed to upsert waypoints: ${upsertErr.message}`);
        results.waypoints = wpRows.length;
      }
    }

    // 3. Sync route legs
    const { data: legs, error: legsErr } = await biteClient
      .from("route_legs")
      .select("*");

    if (legsErr) throw new Error(`Failed to fetch route_legs: ${legsErr.message}`);

    if (legs && legs.length > 0) {
      const legRows = legs.map((l: Record<string, unknown>) => ({
        id: l.id,
        name: l.name,
        description: l.description,
        lat_start: l.lat_start,
        lng_start: l.lng_start,
        lat_end: l.lat_end,
        lng_end: l.lng_end,
        nautical_miles: l.nautical_miles,
        status: l.status,
        sort_order: l.sort_order,
        started_at: l.started_at,
        completed_at: l.completed_at,
        synced_at: now,
      }));

      const { error: upsertErr } = await localClient
        .from("route_legs")
        .upsert(legRows, { onConflict: "id" });

      if (upsertErr) throw new Error(`Failed to upsert route_legs: ${upsertErr.message}`);
      results.route_legs = legRows.length;
    }

    console.log("Sync completed:", results);

    return new Response(JSON.stringify({ success: true, synced: results, synced_at: now }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Sync error:", message);
    return new Response(JSON.stringify({ success: false, error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
