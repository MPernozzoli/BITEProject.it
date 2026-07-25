import { firstQueryParam, readTextBody, sendJson, type NodeRequest, type NodeResponse } from "../../src/server/http.js";

/**
 * Endpoint pubblico di disiscrizione a un solo click (RFC 8058).
 *
 * È il target dell'header `List-Unsubscribe` che `process-email-queue` mette su
 * ogni email di newsletter. Vive sul dominio del brand — non su `*.supabase.co` —
 * perché è l'URL che i provider mostrano accanto al mittente, ed è quello che
 * concorre alla reputazione del dominio.
 *
 * - `POST` con `List-Unsubscribe=One-Click`: il mailbox provider disiscrive
 *   senza alcuna interazione umana. Inoltrato all'edge function, che registra
 *   soppressione e feedback.
 * - `GET`: è una persona che ha cliccato il link nel client di posta. Redirect
 *   alla pagina `/unsubscribe`, dove può scegliere cosa disattivare e lasciare
 *   un motivo.
 */

const SITE_URL = process.env.PUBLIC_SITE_URL || "https://biteproject.it";

function edgeFunctionUrl(token: string): string | null {
  const baseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  if (!baseUrl) return null;
  return `${baseUrl.replace(/\/$/, "")}/functions/v1/handle-email-unsubscribe?token=${encodeURIComponent(token)}`;
}

export default async function handler(req: NodeRequest, res: NodeResponse): Promise<void> {
  const token = firstQueryParam(req, "token");

  if (req.method === "GET") {
    // Nessun token: mandiamo comunque la persona sulla pagina, che sa gestire
    // il caso e mostrare un messaggio sensato.
    const destination = token
      ? `${SITE_URL}/unsubscribe?token=${encodeURIComponent(token)}`
      : `${SITE_URL}/unsubscribe`;
    res.statusCode = 302;
    res.setHeader("Location", destination);
    res.setHeader("Cache-Control", "no-store");
    res.end();
    return;
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET, POST");
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }

  if (!token) {
    sendJson(res, 400, { error: "missing_token" });
    return;
  }

  const target = edgeFunctionUrl(token);
  if (!target) {
    console.error("[email/unsubscribe] SUPABASE_URL non configurato");
    sendJson(res, 503, { error: "not_configured" });
    return;
  }

  try {
    const rawBody = await readTextBody(req);
    // I provider inviano `List-Unsubscribe=One-Click`. Inoltriamo il corpo così
    // com'è: l'edge function distingue il one-click dalla disiscrizione
    // granulare fatta dalla pagina.
    const response = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: rawBody || "List-Unsubscribe=One-Click",
    });

    if (!response.ok) {
      const details = await response.text().catch(() => "");
      console.error("[email/unsubscribe] edge function failed", response.status, details);
      // Un 5xx invoglia il provider a riprovare; per un token già usato o non
      // valido non c'è nulla da riprovare.
      sendJson(res, response.status === 404 || response.status === 410 ? 200 : 502, {
        error: "unsubscribe_failed",
      });
      return;
    }

    sendJson(res, 200, { success: true });
  } catch (error) {
    console.error("[email/unsubscribe] failed", error);
    sendJson(res, 502, { error: "unsubscribe_failed" });
  }
}
