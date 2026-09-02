import { useEffect, type RefObject } from "react";
import { getOrCreateVisitorKey } from "@/lib/visitor-key";
import { getCachedAccessToken, postRpcKeepalive } from "@/lib/tracking-beacon";

/**
 * Sotto questa soglia la visita e' un rimbalzo: quanto in basso sia arrivato
 * chi legge non dice nulla, e registrarlo sporcherebbe la media.
 */
const MIN_VISIT_MS = 1_500;

type Options = {
  articleId?: string | null;
  /**
   * Il contenitore che scorre davvero. Assente significa che scorre la
   * finestra, com'e' nella pagina articolo; il modale del viaggio ha invece
   * il proprio riquadro con overflow.
   */
  containerRef?: RefObject<HTMLElement | null>;
  enabled?: boolean;
};

/**
 * Misura fin dove arriva la lettura e ne manda **un solo** valore per visita.
 *
 * La tabella `article_scroll_events` si chiama `max_scroll_pct` e il punteggio
 * ne fa la media: perche' quella media significhi "profondita' media di
 * lettura" serve una riga per visita con il massimo raggiunto, non una riga
 * per ogni tacca superata. Il valore parte quindi solo alla fine, insieme al
 * teardown della pagina, e per questo viaggia sul beacon keepalive come il
 * tempo di lettura.
 */
export function useArticleScrollTracking({ articleId, containerRef, enabled = true }: Options) {
  useEffect(() => {
    if (!articleId || !enabled) return;
    if (typeof window === "undefined") return;

    const visitorKey = getOrCreateVisitorKey();
    let accessToken: string | null = null;
    void getCachedAccessToken().then((token) => {
      accessToken = token;
    });

    const startedAt = performance.now();
    let maxPct = 0;
    /** Vero quando il contenuto sta tutto nello schermo: letto per intero senza scorrere. */
    let fitsScreen = false;
    let sent = false;

    /**
     * Misura ora e tiene il massimo. Si misura **solo a articolo montato**: al
     * teardown il DOM e' gia' quello della schermata successiva e leggerlo
     * darebbe l'altezza sbagliata.
     */
    const measure = () => {
      const container = containerRef?.current ?? null;
      if (containerRef && !container) return;
      const viewport = container ? container.clientHeight : window.innerHeight;
      // Viewport a zero significa che non c'e' nulla da misurare (riquadro non
      // ancora disteso, scheda senza layout): non e' un articolo corto.
      if (viewport <= 0) return;
      const scrollable = container
        ? container.scrollHeight - container.clientHeight
        : document.documentElement.scrollHeight - window.innerHeight;
      if (scrollable <= 0) {
        // Non latched: se il contenuto cresce (immagini, blocchi lazy) la
        // misura successiva rimette il piede per terra.
        fitsScreen = true;
        return;
      }
      fitsScreen = false;
      const position = container ? container.scrollTop : window.scrollY;
      maxPct = Math.max(maxPct, Math.max(0, Math.min(100, Math.round((position / scrollable) * 100))));
    };

    // Misura diretta, senza `requestAnimationFrame`: i frame si fermano quando
    // la scheda non dipinge, e l'ultima posizione prima di uscire e' proprio
    // quella che conta. Le tre proprieta' lette qui non scrivono nel DOM,
    // quindi non provocano reflow.
    const onScroll = measure;

    const flush = () => {
      if (sent) return;
      sent = true;
      if (performance.now() - startedAt < MIN_VISIT_MS) return;
      postRpcKeepalive(
        "record_article_scroll",
        {
          _article_id: articleId,
          _visitor_key: visitorKey,
          _max_scroll_pct: fitsScreen ? 100 : maxPct,
        },
        accessToken
      );
    };

    const target: HTMLElement | Window = containerRef?.current ?? window;
    target.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", flush);

    // Il contenuto cresce dopo il primo paint (immagini, mappa, blocchi lazy):
    // senza riosservare, un articolo lungo resterebbe marcato "sta nello schermo".
    const observed = containerRef?.current ?? document.documentElement;
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(observed);
    measure();

    return () => {
      resizeObserver.disconnect();
      target.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [articleId, containerRef, enabled]);
}
