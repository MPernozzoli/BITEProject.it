import { firstQueryParam, type NodeRequest, type NodeResponse } from "../../src/server/http.js";
import { createMailServiceClient } from "../../src/server/mail.js";

/**
 * Redirect tracciato dei link delle newsletter, sul dominio del brand.
 *
 * Prima il tracking viveva su `<project>.supabase.co/functions/v1/...`, il che
 * significava spedire da `mail.biteproject.it` messaggi in cui il 100% dei link
 * puntava a un dominio diverso dal mittente — il segnale di spam più forte che
 * avevamo addosso. La registrazione del click avviene qui direttamente via RPC,
 * così il percorso è un solo redirect e non due.
 *
 * L'edge function `newsletter-track-click` resta pubblicata: le email già
 * spedite contengono ancora i vecchi URL e devono continuare a funzionare.
 */

const SITE_URL = process.env.PUBLIC_SITE_URL || "https://biteproject.it";

function redirect(res: NodeResponse, location: string): void {
  res.statusCode = 302;
  res.setHeader("Location", location);
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.end();
}

export default async function handler(req: NodeRequest, res: NodeResponse): Promise<void> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET, HEAD");
    res.end();
    return;
  }

  const deliveryId = firstQueryParam(req, "delivery");
  const token = firstQueryParam(req, "token");
  const target = firstQueryParam(req, "url");

  if (!deliveryId || !token || !target) {
    redirect(res, SITE_URL);
    return;
  }

  let decodedTarget: string | null = null;
  try {
    const parsed = new URL(target);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      decodedTarget = parsed.toString();
    }
  } catch {
    decodedTarget = null;
  }

  if (!decodedTarget) {
    redirect(res, SITE_URL);
    return;
  }

  try {
    const db = createMailServiceClient();
    // Fail closed: senza una delivery valida questo endpoint sarebbe un open
    // redirect sul dominio del brand, sfruttabile per phishing.
    const { data: registered, error } = await db.rpc("newsletter_register_click", {
      p_delivery_id: deliveryId,
      p_token: token,
      p_url: decodedTarget,
    });

    if (error) {
      console.error("[t/click] registrazione fallita", error);
      redirect(res, SITE_URL);
      return;
    }

    if (registered !== true) {
      console.warn("[t/click] delivery/token sconosciuti", { deliveryId });
      redirect(res, SITE_URL);
      return;
    }

    redirect(res, decodedTarget);
  } catch (error) {
    console.error("[t/click] errore", error);
    redirect(res, SITE_URL);
  }
}
