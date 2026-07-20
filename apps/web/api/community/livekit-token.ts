import { AccessToken } from "livekit-server-sdk";
import { createAuthClient, createServiceClient } from "../../src/server/bunq/supabase.js";
import {
  bearerToken,
  readJsonBody,
  sendJson,
  type NodeRequest,
  type NodeResponse,
} from "../../src/server/http.js";

const livekitUrl = () => process.env.LIVEKIT_URL || process.env.PUBLIC_LIVEKIT_URL || process.env.VITE_LIVEKIT_URL || "";
const livekitApiKey = () => process.env.LIVEKIT_API_KEY || "";
const livekitApiSecret = () => process.env.LIVEKIT_API_SECRET || "";

const roomNameFor = (eventId: string) => `bite-crew-${eventId}`;

export default async function handler(req: NodeRequest, res: NodeResponse): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }

  const token = bearerToken(req);
  if (!token) {
    sendJson(res, 401, { error: "unauthenticated" });
    return;
  }

  if (!livekitUrl() || !livekitApiKey() || !livekitApiSecret()) {
    sendJson(res, 503, { error: "livekit_not_configured" });
    return;
  }

  let eventId = "";
  try {
    const body = await readJsonBody<{ eventId?: string }>(req);
    eventId = String(body.eventId ?? "").trim();
  } catch {
    sendJson(res, 400, { error: "invalid_body" });
    return;
  }

  if (!eventId) {
    sendJson(res, 400, { error: "missing_event_id" });
    return;
  }

  try {
    const auth = createAuthClient();
    const { data: userData, error: userError } = await auth.auth.getUser(token);
    if (userError || !userData.user) {
      sendJson(res, 401, { error: "unauthenticated" });
      return;
    }

    const db = createServiceClient();
    const userId = userData.user.id;

    const { data: event, error: eventError } = await db
      .from("community_live_events")
      .select("id, title, livekit_room_name, livekit_mode")
      .eq("id", eventId)
      .maybeSingle();

    const liveEvent = event as { id: string; title: string; livekit_room_name: string | null; livekit_mode: string } | null;
    if (eventError || !liveEvent || liveEvent.livekit_mode === "off") {
      sendJson(res, 404, { error: "live_event_not_found" });
      return;
    }

    const { data: canRead } = await db.rpc("can_read_community_live_event", {
      _event_id: eventId,
      _profile_id: userId,
    });
    const { data: isAdmin } = await db.rpc("has_role", { _user_id: userId, _role: "admin" });
    const { data: isModerator } = await db.rpc("has_role", { _user_id: userId, _role: "moderator" });
    if (!canRead && !isAdmin && !isModerator) {
      sendJson(res, 403, { error: "not_allowed" });
      return;
    }

    let roomName = liveEvent.livekit_room_name || roomNameFor(liveEvent.id);
    if (!liveEvent.livekit_room_name) {
      await db.from("community_live_events").update({ livekit_room_name: roomName }).eq("id", liveEvent.id);
    }

    const { data: profile } = await db
      .from("profiles")
      .select("name")
      .eq("id", userId)
      .maybeSingle();

    const canPublish = Boolean(isAdmin);
    const accessToken = new AccessToken(livekitApiKey(), livekitApiSecret(), {
      identity: userId,
      name: (profile as { name?: string } | null)?.name || userData.user.email || "BITE Crew",
      ttl: "2h",
    });
    accessToken.addGrant({
      room: roomName,
      roomJoin: true,
      canSubscribe: true,
      canPublish,
      canPublishData: canPublish,
      roomAdmin: Boolean(isAdmin),
    });

    sendJson(res, 200, {
      url: livekitUrl(),
      token: await accessToken.toJwt(),
      roomName,
      canPublish,
      isModerator: Boolean(isAdmin || isModerator),
      isAdmin: Boolean(isAdmin),
    });
  } catch (error) {
    console.error("[community/livekit-token] failed", error);
    sendJson(res, 500, { error: "livekit_token_failed" });
  }
}
