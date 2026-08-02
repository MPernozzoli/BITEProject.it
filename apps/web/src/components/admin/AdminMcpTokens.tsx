/**
 * Pannello "Accesso agenti" del profilo admin: emissione e revoca dei token del
 * server MCP (`/api/mcp`).
 *
 * Il valore in chiaro del token arriva solo nella risposta alla creazione e non
 * è recuperabile dopo: la UI lo mostra una volta sola e lo dice esplicitamente.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, Copy, Loader2, Plus, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";

type McpTokenRecord = {
  id: string;
  name: string;
  token_prefix: string;
  scopes: string[];
  created_at: string;
  expires_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

const SCOPE_LABELS: Record<string, { it: string; en: string }> = {
  "articles:read": { it: "Leggere articoli", en: "Read articles" },
  "articles:write": { it: "Scrivere articoli", en: "Write articles" },
  "plan:read": { it: "Leggere il piano", en: "Read the plan" },
  "plan:write": { it: "Programmare nel piano", en: "Schedule in the plan" },
  "newsletter:read": { it: "Leggere le newsletter", en: "Read newsletters" },
  "newsletter:write": { it: "Scrivere newsletter", en: "Write newsletters" },
  "mail:read": { it: "Leggere la posta", en: "Read mail" },
  "mail:write": { it: "Rispondere, inoltrare e scrivere mail", en: "Reply, forward and write mail" },
};

const DEFAULT_SCOPES = ["articles:read", "articles:write", "plan:read", "plan:write", "newsletter:read", "mail:read"];

const COPY = {
  it: {
    eyebrow: "Accesso agenti",
    title: "Token MCP",
    text: "Ogni token dà a un client MCP (Claude Code, Claude Desktop) l'accesso al backoffice con i permessi che scegli qui. Vale finché non scade o non lo revochi.",
    namePlaceholder: "Nome del dispositivo o del client",
    create: "Genera token",
    creating: "Generazione...",
    permissions: "Permessi",
    expiry: "Scadenza",
    days: "giorni",
    empty: "Nessun token attivo.",
    revoke: "Revoca",
    revoked: "Revocato",
    expired: "Scaduto",
    lastUsed: "Ultimo uso",
    never: "mai usato",
    created: "Creato",
    onceTitle: "Copialo adesso: non lo rivedrai",
    onceText: "Questo valore non è recuperabile. Se lo perdi, revoca il token e generane un altro.",
    copy: "Copia",
    copied: "Token copiato.",
    hint: "Configura il client con:",
    loadError: "Impossibile caricare i token.",
    createError: "Creazione del token fallita.",
    revokeError: "Revoca fallita.",
    revokeDone: "Token revocato.",
    nameRequired: "Dai un nome al token.",
  },
  en: {
    eyebrow: "Agent access",
    title: "MCP tokens",
    text: "Each token lets an MCP client (Claude Code, Claude Desktop) reach the backoffice with the permissions you pick here. It stays valid until it expires or you revoke it.",
    namePlaceholder: "Device or client name",
    create: "Generate token",
    creating: "Generating...",
    permissions: "Permissions",
    expiry: "Expiry",
    days: "days",
    empty: "No active tokens.",
    revoke: "Revoke",
    revoked: "Revoked",
    expired: "Expired",
    lastUsed: "Last used",
    never: "never used",
    created: "Created",
    onceTitle: "Copy it now: you won't see it again",
    onceText: "This value cannot be recovered. If you lose it, revoke the token and generate another.",
    copy: "Copy",
    copied: "Token copied.",
    hint: "Configure the client with:",
    loadError: "Could not load tokens.",
    createError: "Token creation failed.",
    revokeError: "Revocation failed.",
    revokeDone: "Token revoked.",
    nameRequired: "Give the token a name.",
  },
};

const AdminMcpTokens = ({ lang }: { lang: "it" | "en" }) => {
  const copy = COPY[lang];
  const [tokens, setTokens] = useState<McpTokenRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(DEFAULT_SCOPES);
  const [expiresInDays, setExpiresInDays] = useState(90);
  const [freshToken, setFreshToken] = useState<string | null>(null);

  const authHeader = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("no_session");
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/mcp/tokens", { headers: await authHeader() });
      if (!response.ok) throw new Error(String(response.status));
      const payload = (await response.json()) as { tokens: McpTokenRecord[] };
      setTokens(payload.tokens ?? []);
    } catch (error) {
      console.error("[mcp tokens] load failed", error);
      toast.error(copy.loadError);
    } finally {
      setLoading(false);
    }
  }, [authHeader, copy.loadError]);

  useEffect(() => {
    void load();
  }, [load]);

  const createToken = async () => {
    if (name.trim().length < 2) {
      toast.error(copy.nameRequired);
      return;
    }
    setCreating(true);
    try {
      const response = await fetch("/api/mcp/tokens", {
        method: "POST",
        headers: await authHeader(),
        body: JSON.stringify({ name: name.trim(), scopes, expiresInDays }),
      });
      const payload = (await response.json()) as { token?: string; message?: string };
      if (!response.ok || !payload.token) throw new Error(payload.message || String(response.status));
      setFreshToken(payload.token);
      setName("");
      await load();
    } catch (error) {
      console.error("[mcp tokens] create failed", error);
      toast.error(error instanceof Error && error.message.length < 120 ? error.message : copy.createError);
    } finally {
      setCreating(false);
    }
  };

  const revokeToken = async (id: string) => {
    setRevokingId(id);
    try {
      const response = await fetch(`/api/mcp/tokens?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: await authHeader(),
      });
      if (!response.ok) throw new Error(String(response.status));
      toast.success(copy.revokeDone);
      await load();
    } catch (error) {
      console.error("[mcp tokens] revoke failed", error);
      toast.error(copy.revokeError);
    } finally {
      setRevokingId(null);
    }
  };

  const activeTokens = useMemo(() => tokens.filter((token) => !token.revoked_at), [tokens]);

  const formatDate = (value: string | null) => {
    if (!value) return copy.never;
    return new Intl.DateTimeFormat(lang, { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
  };

  return (
    <div className="rounded-[34px] border border-stone-200/85 bg-white/60 p-6 md:p-8 shadow-[0_20px_48px_rgba(15,23,42,0.06)]">
      <p className="text-[11px] font-sans uppercase tracking-[0.28em] text-muted-foreground mb-2">{copy.eyebrow}</p>
      <h2 className="editorial-heading text-2xl md:text-3xl mb-3 flex items-center gap-3">
        <Bot size={22} className="text-accent" />
        {copy.title}
      </h2>
      <p className="text-sm font-sans text-muted-foreground leading-relaxed mb-6">{copy.text}</p>

      {freshToken && (
        <div className="mb-6 rounded-[24px] border border-accent/40 bg-accent/8 p-5">
          <p className="font-sans text-sm font-medium text-foreground">{copy.onceTitle}</p>
          <p className="mt-1 text-xs font-sans text-muted-foreground">{copy.onceText}</p>
          <div className="mt-3 flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded-[14px] border border-white/70 bg-background/80 px-3 py-2 text-xs">
              {freshToken}
            </code>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-full"
              onClick={() => {
                void navigator.clipboard.writeText(freshToken);
                toast.success(copy.copied);
              }}
            >
              <Copy size={14} />
              {copy.copy}
            </Button>
          </div>
          <p className="mt-3 text-xs font-sans text-muted-foreground">{copy.hint}</p>
          <code className="mt-1 block overflow-x-auto rounded-[14px] border border-white/70 bg-background/80 px-3 py-2 text-[11px]">
            {`claude mcp add --transport http bite-admin https://admin.biteproject.it/mcp --header "Authorization: Bearer ${freshToken}"`}
          </code>
        </div>
      )}

      <div className="rounded-[24px] border border-white/60 bg-white/68 p-5 space-y-4">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={copy.namePlaceholder}
          maxLength={80}
          className="rounded-[16px]"
        />

        <div>
          <p className="text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground mb-2">
            {copy.permissions}
          </p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(SCOPE_LABELS).map(([scope, label]) => {
              const selected = scopes.includes(scope);
              return (
                <button
                  key={scope}
                  type="button"
                  onClick={() =>
                    setScopes((prev) => (prev.includes(scope) ? prev.filter((item) => item !== scope) : [...prev, scope]))
                  }
                  className={`rounded-full border px-3 py-1.5 text-xs font-sans transition-colors ${
                    selected
                      ? "border-accent bg-accent/12 text-foreground"
                      : "border-border/70 bg-background/60 text-muted-foreground hover:border-accent/50"
                  }`}
                >
                  {label[lang]}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <p className="text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground mb-2">{copy.expiry}</p>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                max={365}
                value={expiresInDays}
                onChange={(event) => setExpiresInDays(Number(event.target.value) || 90)}
                className="w-24 rounded-[16px]"
              />
              <span className="text-sm font-sans text-muted-foreground">{copy.days}</span>
            </div>
          </div>
          <Button type="button" onClick={() => void createToken()} disabled={creating} className="rounded-full">
            {creating ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
            {creating ? copy.creating : copy.create}
          </Button>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {loading ? (
          <p className="text-sm font-sans text-muted-foreground">…</p>
        ) : activeTokens.length === 0 ? (
          <div className="rounded-[24px] border border-dashed border-white/70 bg-white/52 px-5 py-8 text-sm font-sans text-muted-foreground">
            {copy.empty}
          </div>
        ) : (
          activeTokens.map((token) => {
            const expired = new Date(token.expires_at).getTime() <= Date.now();
            return (
              <div
                key={token.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-[24px] border border-white/60 bg-white/68 px-4 py-4"
              >
                <div className="min-w-0">
                  <p className="font-sans text-sm font-medium text-foreground truncate">
                    {token.name}
                    {expired && <span className="ml-2 text-xs text-destructive">{copy.expired}</span>}
                  </p>
                  <p className="mt-1 text-xs font-sans text-muted-foreground">
                    <code>{token.token_prefix}…</code> · {copy.created} {formatDate(token.created_at)} ·{" "}
                    {copy.lastUsed} {formatDate(token.last_used_at)}
                  </p>
                  <p className="mt-1 text-[11px] font-sans text-muted-foreground">
                    {token.scopes.map((scope) => SCOPE_LABELS[scope]?.[lang] ?? scope).join(" · ")}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={revokingId === token.id}
                  onClick={() => void revokeToken(token.id)}
                  className="rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                >
                  <ShieldOff size={14} />
                  {copy.revoke}
                </Button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default AdminMcpTokens;
