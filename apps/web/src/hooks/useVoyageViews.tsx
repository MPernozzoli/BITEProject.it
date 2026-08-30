/**
 * Tracking delle pagine viaggio.
 *
 * Gemello di `useArticleReads` per l'altra metà del sito. Le differenze sono
 * due, e nascono da cosa una pagina viaggio è:
 *
 * - **Nessun contatore pubblico.** Un articolo mostra le proprie letture; un
 *   viaggio no. Qui si registra l'evento e basta, senza rimbalzare un numero
 *   nella cache di React Query.
 * - **Un solo evento per visita.** Durata e profondità di scroll si fondono
 *   sull'evento di atterraggio (`record_voyage_view_engagement`), invece di
 *   vivere in tabelle separate come per gli articoli.
 */
import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getOrCreateVisitorKey } from "@/lib/visitor-key";
import { attributionRpcArgs } from "@/lib/attribution";
import { getCachedAccessToken, postRpcKeepalive } from "@/lib/tracking-beacon";

const VIEW_RETRY_MS = 5_000;
/** Sotto questa soglia la visita è un rimbalzo: non dice nulla sul viaggio. */
const MIN_DWELL_MS = 1_500;
const MAX_DWELL_MS = 6 * 60 * 60 * 1000;

type RpcClient = {
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ error: unknown }>;
};

const rpcClient = supabase as unknown as RpcClient;

/**
 * Percentuale di pagina raggiunta, 0-100. `null` finché la pagina non è
 * scrollabile: all'inizio la pagina viaggio è ancora vuota — le sezioni
 * montano man mano che le query rispondono — e misurarla lì direbbe "100%
 * letto" di una pagina che non esisteva ancora.
 */
function currentScrollPct(): number | null {
  if (typeof document === "undefined") return null;
  const doc = document.documentElement;
  const scrollable = doc.scrollHeight - window.innerHeight;
  if (scrollable <= 0) return null;
  const ratio = (window.scrollY || doc.scrollTop || 0) / scrollable;
  return Math.max(0, Math.min(100, Math.round(ratio * 100)));
}

/**
 * Registra la visita alla pagina viaggio e, all'uscita, quanto è durata e fin
 * dove è arrivata. Una sola registrazione per viaggio, con retry: la
 * provenienza della sessione viaggia insieme all'evento.
 */
export function useVoyageViewTracking(voyageId?: string | null, lang?: string | null) {
  const langRef = useRef<string | null | undefined>(lang);
  langRef.current = lang;

  // Atterraggio.
  useEffect(() => {
    if (!voyageId) return;

    let cancelled = false;
    let retryTimeoutId: number | null = null;

    const registerView = async () => {
      const { error } = await rpcClient.rpc("record_voyage_view", {
        _voyage_id: voyageId,
        _visitor_key: getOrCreateVisitorKey(),
        _lang: langRef.current ?? undefined,
        ...attributionRpcArgs(),
      });

      if (error && !cancelled) {
        retryTimeoutId = window.setTimeout(() => {
          retryTimeoutId = null;
          void registerView();
        }, VIEW_RETRY_MS);
      }
    };

    void registerView();

    return () => {
      cancelled = true;
      if (retryTimeoutId !== null) window.clearTimeout(retryTimeoutId);
    };
  }, [voyageId]);

  // Permanenza e scroll.
  useEffect(() => {
    if (!voyageId) return;
    if (typeof document === "undefined") return;

    const visitorKey = getOrCreateVisitorKey();
    let accessToken: string | null = null;
    void getCachedAccessToken().then((token) => {
      accessToken = token;
    });

    let accumulatedMs = 0;
    let maxScrollPct = 0;
    let visibleSince: number | null = document.visibilityState === "visible" ? performance.now() : null;

    const accumulate = () => {
      if (visibleSince !== null) {
        accumulatedMs += performance.now() - visibleSince;
        visibleSince = null;
      }
    };

    const handleScroll = () => {
      const pct = currentScrollPct();
      if (pct !== null && pct > maxScrollPct) maxScrollPct = pct;
    };

    const flush = () => {
      accumulate();
      const dwell = Math.round(Math.min(Math.max(accumulatedMs, 0), MAX_DWELL_MS));
      // Una pagina che entra tutta nella viewport è stata vista per intero,
      // ma solo se ci si è fermati abbastanza da guardarla.
      if (currentScrollPct() === null && dwell >= MIN_DWELL_MS) maxScrollPct = 100;
      else handleScroll();
      if (dwell < MIN_DWELL_MS && maxScrollPct <= 0) return;

      postRpcKeepalive(
        "record_voyage_view_engagement",
        {
          _voyage_id: voyageId,
          _visitor_key: visitorKey,
          _dwell_ms: dwell >= MIN_DWELL_MS ? dwell : 0,
          _max_scroll_pct: maxScrollPct,
        },
        accessToken
      );
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        if (visibleSince === null) visibleSince = performance.now();
      } else {
        flush();
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pagehide", flush);

    return () => {
      window.removeEventListener("scroll", handleScroll);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [voyageId]);
}
