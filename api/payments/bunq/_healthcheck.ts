/**
 * TEMPORARY diagnostic endpoint — completes the Bunq installation/device-server/session-server
 * handshake against the live account and confirms the API key works. Not linked from the app;
 * gated by a one-off secret embedded at deploy time. Remove after use.
 */
import { bunqConfigured, environment, accountPath, bunqRequest } from "../../../src/server/bunq/client.js";
import { sendJson, type NodeRequest, type NodeResponse } from "../../../src/server/http.js";

const HEALTHCHECK_SECRET = "9b430cf20eff7ed8157247fb38599aa69a0fc650d9055aac";

type MonetaryAccountResponse = Array<{
  MonetaryAccountBank?: {
    id: number;
    description: string;
    currency: string;
    status: string;
  };
}>;

export default async function handler(req: NodeRequest, res: NodeResponse): Promise<void> {
  const header = req.headers["x-healthcheck-secret"];
  const provided = Array.isArray(header) ? header[0] : header;
  if (provided !== HEALTHCHECK_SECRET) {
    sendJson(res, 404, { error: "not_found" });
    return;
  }

  if (!bunqConfigured()) {
    sendJson(res, 200, { configured: false });
    return;
  }

  try {
    const result = await bunqRequest<MonetaryAccountResponse>(accountPath());
    const account = result.find((r) => r.MonetaryAccountBank)?.MonetaryAccountBank;
    sendJson(res, 200, {
      configured: true,
      environment: environment(),
      account: account
        ? { id: account.id, description: account.description, status: account.status, currency: account.currency }
        : null,
    });
  } catch (error) {
    sendJson(res, 200, {
      configured: true,
      handshakeFailed: true,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
