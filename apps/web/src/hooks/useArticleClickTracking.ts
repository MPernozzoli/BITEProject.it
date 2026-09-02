import { useEffect, type RefObject } from "react";
import { getOrCreateVisitorKey } from "@/lib/visitor-key";
import { getCachedAccessToken, postRpcKeepalive } from "@/lib/tracking-beacon";

/** Oltre questa lunghezza l'indirizzo non aggiunge informazione, solo peso. */
const MAX_HREF_LENGTH = 500;

type Options = {
  articleId?: string | null;
  /**
   * Radice in cui ascoltare. Assente significa l'intero documento, com'e'
   * nella pagina articolo; il modale del viaggio passa il proprio riquadro
   * per non contare i click della pagina che gli sta sotto.
   */
  rootRef?: RefObject<HTMLElement | null>;
  enabled?: boolean;
};

const truncateHref = (href: string | null) =>
  href ? href.slice(0, MAX_HREF_LENGTH) : null;

/**
 * Registra i click che portano *fuori* dal testo: i link dentro il corpo
 * dell'articolo e le CTA marcate con `data-article-cta`.
 *
 * L'ascolto e' delegato su una sola radice invece che sul singolo link, perche'
 * il corpo dell'articolo e' HTML generato da TipTap: i suoi `<a>` non passano
 * mai da un componente React a cui appendere un handler.
 *
 * L'invio usa il beacon keepalive: un click in uscita smonta la pagina prima
 * che una fetch normale abbia finito.
 */
export function useArticleClickTracking({ articleId, rootRef, enabled = true }: Options) {
  useEffect(() => {
    if (!articleId || !enabled) return;
    if (typeof document === "undefined") return;

    const visitorKey = getOrCreateVisitorKey();
    let accessToken: string | null = null;
    void getCachedAccessToken().then((token) => {
      accessToken = token;
    });

    // Un click ripetuto sullo stesso bersaglio e' impazienza, non un secondo
    // interesse: si conta una volta per visita.
    const seen = new Set<string>();

    const onClick = (event: Event) => {
      const mouseEvent = event as MouseEvent;
      if (typeof mouseEvent.button === "number" && mouseEvent.button !== 0) return;

      const target = mouseEvent.target;
      if (!(target instanceof Element)) return;

      const cta = target.closest<HTMLElement>("[data-article-cta]");
      const anchor = target.closest<HTMLAnchorElement>("a[href]");
      if (!cta && !anchor) return;
      // Fuori dal corpo dell'articolo contano solo le CTA dichiarate: gli altri
      // link della pagina (navigazione, sidebar, footer) non sono un lead.
      if (!cta && !anchor?.closest(".article-rich-body")) return;

      const href = truncateHref(anchor?.href ?? cta?.getAttribute("href") ?? null);
      const clickType = cta
        ? cta.dataset.articleCta || "cta"
        : anchor && anchor.origin === window.location.origin
          ? "internal"
          : "outbound";

      const dedupeKey = `${clickType}|${href ?? ""}`;
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);

      postRpcKeepalive(
        "record_article_click",
        {
          _article_id: articleId,
          _visitor_key: visitorKey,
          _click_type: clickType,
          _href: href,
        },
        accessToken
      );
    };

    // Fase di cattura, non di risalita: React delega i propri handler alla
    // radice dell'app, e il `preventDefault` con cui `<Link>` prende in
    // consegna la navigazione scatterebbe prima di noi. In cattura il click si
    // vede sempre, chiunque poi lo annulli.
    const root: HTMLElement | Document = rootRef?.current ?? document;
    root.addEventListener("click", onClick, true);

    return () => {
      root.removeEventListener("click", onClick, true);
    };
  }, [articleId, rootRef, enabled]);
}
