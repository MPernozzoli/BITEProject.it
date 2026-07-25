import { firstQueryParam, type NodeRequest, type NodeResponse } from "../../src/server/http.js";
import { createMailServiceClient } from "../../src/server/mail.js";

/**
 * Pixel di apertura delle newsletter, sul dominio del brand invece che su
 * `<project>.supabase.co` — vedi la nota in `api/t/click.ts`.
 *
 * Risponde sempre con il GIF, qualunque cosa accada: un errore di tracking non
 * deve tradursi in un'immagine rotta dentro l'email.
 */

const PIXEL = Uint8Array.from([
  71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0, 0, 0, 0, 255, 255, 255, 33,
  249, 4, 1, 0, 0, 1, 0, 44, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 68, 1, 0, 59,
]);

function sendPixel(res: NodeResponse): void {
  res.statusCode = 200;
  res.setHeader("Content-Type", "image/gif");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Content-Length", String(PIXEL.byteLength));
  res.end(PIXEL);
}

export default async function handler(req: NodeRequest, res: NodeResponse): Promise<void> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendPixel(res);
    return;
  }

  const deliveryId = firstQueryParam(req, "delivery");
  const token = firstQueryParam(req, "token");

  if (!deliveryId || !token) {
    sendPixel(res);
    return;
  }

  try {
    const db = createMailServiceClient();
    const { error } = await db.rpc("newsletter_register_open", {
      p_delivery_id: deliveryId,
      p_token: token,
    });

    if (error) {
      console.error("[t/open] registrazione fallita", error);
    }
  } catch (error) {
    console.error("[t/open] errore", error);
  }

  sendPixel(res);
}
