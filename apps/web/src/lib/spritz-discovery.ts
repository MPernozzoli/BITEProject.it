import { supabase } from "@/integrations/supabase/client";
import { getOrCreateVisitorKey } from "@/lib/visitor-key";

// Once per page load: replays within the same visit would only inflate play_count.
let recorded = false;

/**
 * Logs that the S/Y Spritz easter egg was opened. Fire-and-forget — the game
 * must never wait on it, and a failure here is not worth surfacing to whoever
 * just found the thing.
 */
export async function recordSpritzDiscovery(): Promise<void> {
  if (recorded) return;
  recorded = true;

  try {
    const { error } = await supabase.rpc("record_spritz_discovery" as never, {
      _visitor_key: getOrCreateVisitorKey(),
    } as never);

    if (error) {
      recorded = false;
      console.warn("Spritz discovery not recorded", error.message);
    }
  } catch {
    recorded = false;
  }
}
