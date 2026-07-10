/**
 * Minimal Bunq API client (ported from the Menuary/BePork implementation).
 *
 * Handles the full handshake — installation + device-server + session-server — signing
 * every request with an RSA key pair, and verifying the server signature on responses.
 * The installation context is generated once and persisted (encrypted) in Supabase so it
 * survives cold starts. Sessions are cached in-memory per environment.
 *
 * Runs ONLY inside Vercel serverless functions (Node runtime). Requires env:
 *   BUNQ_API_TOKEN, BUNQ_USER_ID, BUNQ_MONETARY_ACCOUNT_ID
 *   BUNQ_SANDBOX=true|false (default false → production)
 *   BUNQ_PERMITTED_IPS (optional, comma-separated; default "*")
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
  verify,
} from "node:crypto";
import { createServiceClient } from "./supabase";

const BUNQ_API = "https://api.bunq.com/v1";
const BUNQ_SANDBOX_API = "https://public-api.sandbox.bunq.com/v1";
const BUNQ_USER_AGENT = "bite-platform/1.0";
const DEFAULT_SESSION_TTL_MS = 5 * 60 * 1000;

type BunqEnvironment = "production" | "sandbox";

type BunqApiContext = {
  privateKeyPem: string;
  publicKeyPem: string;
  installationToken: string;
  serverPublicKeyPem: string;
};

type BunqSession = {
  token: string;
  expiresAt: number;
};

type BunqResponseEnvelope<T> = {
  Response?: T;
  Error?: Array<{ error_description?: string }>;
};

type InstallationResponse = Array<
  | { Id: { id: number } }
  | { Token: { token: string } }
  | { ServerPublicKey: { server_public_key: string } }
>;

type SessionResponse = Array<
  | { Token: { token: string } }
  | Record<string, { session_timeout?: number }>
>;

const sessionCache = new Map<BunqEnvironment, BunqSession>();
const contextCache = new Map<BunqEnvironment, BunqApiContext>();
const contextPromises = new Map<BunqEnvironment, Promise<BunqApiContext>>();
const sessionPromises = new Map<BunqEnvironment, Promise<BunqSession>>();

export function bunqConfigured(): boolean {
  return Boolean(
    process.env.BUNQ_API_TOKEN &&
      process.env.BUNQ_USER_ID &&
      process.env.BUNQ_MONETARY_ACCOUNT_ID,
  );
}

function apiBase(): string {
  return process.env.BUNQ_SANDBOX === "true" ? BUNQ_SANDBOX_API : BUNQ_API;
}

export function environment(): BunqEnvironment {
  return process.env.BUNQ_SANDBOX === "true" ? "sandbox" : "production";
}

function apiToken(): string {
  const token = process.env.BUNQ_API_TOKEN;
  if (!token) throw new Error("bunq_api_token_unset");
  return token;
}

function contextEncryptionKey(): Buffer {
  return createHash("sha256")
    .update(`bite:bunq-context:${apiToken()}`, "utf8")
    .digest();
}

function encryptContext(context: BunqApiContext): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", contextEncryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(context), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(".");
}

function decryptContext(payload: string): BunqApiContext {
  const [version, ivBase64, tagBase64, ciphertextBase64] = payload.split(".");
  if (version !== "v1" || !ivBase64 || !tagBase64 || !ciphertextBase64) {
    throw new Error("bunq_context_invalid");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    contextEncryptionKey(),
    Buffer.from(ivBase64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagBase64, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextBase64, "base64")),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(plaintext) as BunqApiContext;
}

async function loadPersistedContext(
  targetEnvironment: BunqEnvironment,
): Promise<BunqApiContext | null> {
  const db = createServiceClient();
  const { data, error } = await db
    .from("bunq_api_contexts")
    .select("encrypted_context")
    .eq("environment", targetEnvironment)
    .maybeSingle();

  if (error) throw new Error(`bunq_context_load_failed:${error.message}`);
  return data ? decryptContext((data as { encrypted_context: string }).encrypted_context) : null;
}

async function persistContext(
  targetEnvironment: BunqEnvironment,
  context: BunqApiContext,
): Promise<void> {
  const db = createServiceClient();
  const { error } = await db.from("bunq_api_contexts").upsert(
    {
      environment: targetEnvironment,
      encrypted_context: encryptContext(context),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "environment" },
  );

  if (error) throw new Error(`bunq_context_save_failed:${error.message}`);
}

export function monetaryAccountId(): string {
  const id = process.env.BUNQ_MONETARY_ACCOUNT_ID;
  if (!id) throw new Error("bunq_monetary_account_id_unset");
  return id;
}

function userId(): string {
  const id = process.env.BUNQ_USER_ID;
  if (!id) throw new Error("bunq_user_id_unset");
  return id;
}

export type BunqRequestInit = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: Record<string, unknown>;
};

export type BunqError = {
  message: string;
  status: number;
};

function compactJson(body: Record<string, unknown> | undefined): string {
  return body ? JSON.stringify(body) : "";
}

function requestHeaders(params: {
  authentication?: string;
  body?: string;
  privateKeyPem?: string;
}): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Cache-Control": "no-cache",
    "User-Agent": BUNQ_USER_AGENT,
    "X-Bunq-Language": "en_US",
    "X-Bunq-Region": "it_IT",
    "X-Bunq-Geolocation": "0 0 0 0 000",
    "X-Bunq-Client-Request-Id": randomUUID(),
  };
  if (params.authentication) {
    headers["X-Bunq-Client-Authentication"] = params.authentication;
  }
  if (params.body && params.privateKeyPem) {
    headers["X-Bunq-Client-Signature"] = sign(
      "RSA-SHA256",
      Buffer.from(params.body, "utf8"),
      params.privateKeyPem,
    ).toString("base64");
  }
  return headers;
}

function parseBunqError(
  status: number,
  json: BunqResponseEnvelope<unknown> | null,
): Error {
  const message =
    json?.Error?.[0]?.error_description ?? `bunq_request_failed_${status}`;
  const err: BunqError = { message, status };
  return Object.assign(new Error(message), { bunq: err });
}

function verifyServerResponse(
  responseBody: string,
  signatureBase64: string | null,
  serverPublicKeyPem: string,
): void {
  if (!signatureBase64) return;
  const valid = verify(
    "RSA-SHA256",
    Buffer.from(responseBody, "utf8"),
    serverPublicKeyPem,
    Buffer.from(signatureBase64, "base64"),
  );
  if (!valid) throw new Error("bunq_server_signature_invalid");
}

async function executeRequest<T>(params: {
  path: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  body?: Record<string, unknown>;
  authentication?: string;
  privateKeyPem?: string;
  serverPublicKeyPem?: string;
}): Promise<T> {
  const body = compactJson(params.body);
  const res = await fetch(`${apiBase()}${params.path}`, {
    method: params.method,
    headers: requestHeaders({
      authentication: params.authentication,
      body,
      privateKeyPem: params.privateKeyPem,
    }),
    body: body || undefined,
    cache: "no-store",
  });
  const responseBody = await res.text();
  const json = responseBody
    ? (JSON.parse(responseBody) as BunqResponseEnvelope<T>)
    : null;
  if (!res.ok) {
    throw parseBunqError(res.status, json);
  }
  if (params.serverPublicKeyPem) {
    verifyServerResponse(
      responseBody,
      res.headers.get("x-bunq-server-signature"),
      params.serverPublicKeyPem,
    );
  }
  const response = json?.Response;
  if (!response) throw new Error("bunq_empty_response");
  return response;
}

function responseEntry<T>(
  response: Array<Record<string, unknown>>,
  key: string,
): T | null {
  const entry = response.find((item) => key in item);
  return entry ? (entry[key] as T) : null;
}

async function bootstrapContext(): Promise<BunqApiContext> {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const installation = await executeRequest<InstallationResponse>({
    path: "/installation",
    method: "POST",
    body: { client_public_key: publicKey },
  });
  const installationToken = responseEntry<{ token: string }>(
    installation as Array<Record<string, unknown>>,
    "Token",
  )?.token;
  const serverPublicKeyPem = responseEntry<{ server_public_key: string }>(
    installation as Array<Record<string, unknown>>,
    "ServerPublicKey",
  )?.server_public_key;
  if (!installationToken || !serverPublicKeyPem) {
    throw new Error("bunq_installation_context_incomplete");
  }

  await executeRequest({
    path: "/device-server",
    method: "POST",
    authentication: installationToken,
    privateKeyPem: privateKey,
    serverPublicKeyPem,
    body: {
      description: `BITE Vercel ${environment()}`,
      secret: apiToken(),
      permitted_ips: (process.env.BUNQ_PERMITTED_IPS ?? "*")
        .split(",")
        .map((ip) => ip.trim())
        .filter(Boolean),
    },
  });

  const context = {
    privateKeyPem: privateKey,
    publicKeyPem: publicKey,
    installationToken,
    serverPublicKeyPem,
  };
  await persistContext(environment(), context);
  return context;
}

async function getContext(): Promise<BunqApiContext> {
  const targetEnvironment = environment();
  const cached = contextCache.get(targetEnvironment);
  if (cached) return cached;
  const pending = contextPromises.get(targetEnvironment);
  if (pending) return pending;

  const promise = (async () => {
    const context =
      (await loadPersistedContext(targetEnvironment)) ?? (await bootstrapContext());
    contextCache.set(targetEnvironment, context);
    return context;
  })().finally(() => {
    contextPromises.delete(targetEnvironment);
  });
  contextPromises.set(targetEnvironment, promise);
  return promise;
}

function sessionTimeoutSeconds(response: SessionResponse): number | null {
  for (const entry of response) {
    for (const [key, value] of Object.entries(entry)) {
      if (key.startsWith("User") && value?.session_timeout) {
        return value.session_timeout;
      }
    }
  }
  return null;
}

async function createSession(): Promise<BunqSession> {
  const context = await getContext();
  const response = await executeRequest<SessionResponse>({
    path: "/session-server",
    method: "POST",
    authentication: context.installationToken,
    privateKeyPem: context.privateKeyPem,
    serverPublicKeyPem: context.serverPublicKeyPem,
    body: { secret: apiToken() },
  });
  const token = responseEntry<{ token: string }>(
    response as Array<Record<string, unknown>>,
    "Token",
  )?.token;
  if (!token) throw new Error("bunq_session_token_missing");
  const timeoutSeconds = sessionTimeoutSeconds(response);
  return {
    token,
    expiresAt:
      Date.now() +
      (timeoutSeconds ? Math.max(60, timeoutSeconds - 60) * 1000 : DEFAULT_SESSION_TTL_MS),
  };
}

async function getSession(forceRefresh = false): Promise<BunqSession> {
  const targetEnvironment = environment();
  const cached = sessionCache.get(targetEnvironment);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached;
  const pending = sessionPromises.get(targetEnvironment);
  if (pending) return pending;

  const promise = createSession()
    .then((session) => {
      sessionCache.set(targetEnvironment, session);
      return session;
    })
    .finally(() => {
      sessionPromises.delete(targetEnvironment);
    });
  sessionPromises.set(targetEnvironment, promise);
  return promise;
}

function bunqStatus(error: unknown): number | null {
  return error &&
    typeof error === "object" &&
    "bunq" in error &&
    error.bunq &&
    typeof error.bunq === "object" &&
    "status" in error.bunq &&
    typeof error.bunq.status === "number"
    ? error.bunq.status
    : null;
}

export async function bunqRequest<T>(
  path: string,
  init: BunqRequestInit = {},
): Promise<T> {
  const context = await getContext();
  const method = init.method ?? "GET";

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const session = await getSession(attempt > 0);
    try {
      return await executeRequest<T>({
        path,
        method,
        body: init.body,
        authentication: session.token,
        privateKeyPem: context.privateKeyPem,
        serverPublicKeyPem: context.serverPublicKeyPem,
      });
    } catch (error) {
      if (attempt === 0 && bunqStatus(error) === 401) {
        sessionCache.delete(environment());
        continue;
      }
      throw error;
    }
  }
  throw new Error("bunq_session_retry_exhausted");
}

export function userPath(): string {
  return `/user/${userId()}`;
}

export function accountPath(): string {
  return `${userPath()}/monetary-account/${monetaryAccountId()}`;
}
