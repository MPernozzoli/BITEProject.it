/**
 * Pagina di consenso OAuth del server MCP (`/admin/mcp/authorize`).
 *
 * È l'unico punto del flusso in cui c'è un umano: `/api/mcp/oauth/authorize` ha
 * già validato client e redirect_uri, qui l'admin vede *chi* sta chiedendo
 * accesso, sceglie quali permessi concedere e approva. L'authorization code lo
 * emette il server, non questa pagina.
 *
 * Non usa `AdminRoute` di proposito: quel guard, reindirizzando al login,
 * conserva solo il pathname e perderebbe i parametri OAuth nella query.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Bot, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { getLoginUrl } from "@/lib/admin-host";
import { useI18n } from "@/lib/i18n";

const SCOPE_LABELS: Record<string, { it: string; en: string }> = {
  "articles:read": { it: "Leggere gli articoli", en: "Read articles" },
  "articles:write": { it: "Scrivere e modificare articoli", en: "Write and edit articles" },
  "plan:read": { it: "Leggere il piano editoriale", en: "Read the editorial plan" },
  "plan:write": { it: "Programmare nel piano editoriale", en: "Schedule in the editorial plan" },
  "newsletter:read": { it: "Leggere le newsletter", en: "Read newsletters" },
  "newsletter:write": { it: "Scrivere e schedulare newsletter", en: "Write and schedule newsletters" },
  "mail:read": { it: "Leggere la posta", en: "Read mail" },
  "mail:write": { it: "Rispondere, inoltrare e scrivere mail", en: "Reply, forward and write mail" },
};

const ALL_SCOPES = Object.keys(SCOPE_LABELS);

const COPY = {
  it: {
    eyebrow: "Autorizzazione agente",
    title: "Vuoi dare accesso al backoffice?",
    intro: (client: string) => `"${client}" chiede di collegarsi al backoffice BITE con il tuo account admin.`,
    permissions: "Permessi richiesti",
    hint: "Puoi togliere quello che non serve: l'agente riceverà solo ciò che lasci selezionato.",
    note: "L'agente non potrà pubblicare né spedire nulla: può solo preparare e programmare. Puoi revocare l'accesso quando vuoi dal tuo profilo.",
    approve: "Autorizza",
    approving: "Autorizzazione...",
    deny: "Rifiuta",
    checking: "Verifica sessione...",
    needLogin: "Devi accedere con il tuo account admin per continuare.",
    login: "Accedi",
    notAdmin: "Questo account non è admin: non può autorizzare un client MCP.",
    invalid: "Richiesta di autorizzazione incompleta o non valida.",
    failed: "Autorizzazione fallita.",
    noScope: "Seleziona almeno un permesso.",
    redirect: "Reindirizzamento al client...",
  },
  en: {
    eyebrow: "Agent authorization",
    title: "Grant access to the backoffice?",
    intro: (client: string) => `"${client}" is asking to connect to the BITE backoffice with your admin account.`,
    permissions: "Requested permissions",
    hint: "Uncheck anything it doesn't need: the agent only gets what stays selected.",
    note: "The agent can never publish or send: it can only prepare and schedule. You can revoke access any time from your profile.",
    approve: "Authorize",
    approving: "Authorizing...",
    deny: "Deny",
    checking: "Checking session...",
    needLogin: "Sign in with your admin account to continue.",
    login: "Sign in",
    notAdmin: "This account is not an admin: it cannot authorize an MCP client.",
    invalid: "Incomplete or invalid authorization request.",
    failed: "Authorization failed.",
    noScope: "Select at least one permission.",
    redirect: "Redirecting to the client...",
  },
};

const AdminMcpAuthorize = () => {
  const [searchParams] = useSearchParams();
  const { session, isAdmin, loading, adminLoading } = useAuth();
  const { lang } = useI18n();
  const copy = COPY[lang === "en" ? "en" : "it"];

  const clientId = searchParams.get("client_id") ?? "";
  const redirectUri = searchParams.get("redirect_uri") ?? "";
  const codeChallenge = searchParams.get("code_challenge") ?? "";
  const codeChallengeMethod = searchParams.get("code_challenge_method") ?? "S256";
  const state = searchParams.get("state") ?? "";
  const resource = searchParams.get("resource") ?? "";

  const requestedScopes = useMemo(() => {
    const raw = (searchParams.get("scope") ?? "").split(/[\s+]+/).filter(Boolean);
    const valid = raw.filter((scope) => ALL_SCOPES.includes(scope));
    return valid.length > 0 ? valid : ALL_SCOPES;
  }, [searchParams]);

  const [granted, setGranted] = useState<string[]>([]);
  const [clientName, setClientName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setGranted(requestedScopes);
  }, [requestedScopes]);

  const paramsValid = Boolean(clientId && redirectUri && codeChallenge && codeChallengeMethod === "S256");

  useEffect(() => {
    if (!paramsValid || !session) return;
    void (async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;
      const response = await fetch(`/api/mcp/oauth/approve?client_id=${encodeURIComponent(clientId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return;
      const payload = (await response.json()) as { client_name?: string };
      setClientName(payload.client_name ?? "");
    })();
  }, [clientId, paramsValid, session]);

  const approve = useCallback(async () => {
    if (granted.length === 0) {
      setError(copy.noScope);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("no_session");

      const response = await fetch("/api/mcp/oauth/approve", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          redirect_uri: redirectUri,
          code_challenge: codeChallenge,
          code_challenge_method: codeChallengeMethod,
          state,
          scopes: granted,
          resource: resource || undefined,
        }),
      });
      const payload = (await response.json()) as { redirect_to?: string; error_description?: string };
      if (!response.ok || !payload.redirect_to) throw new Error(payload.error_description || copy.failed);

      window.location.replace(payload.redirect_to);
    } catch (cause) {
      console.error("[mcp oauth] approve failed", cause);
      setError(cause instanceof Error && cause.message.length < 200 ? cause.message : copy.failed);
      setSubmitting(false);
    }
  }, [clientId, codeChallenge, codeChallengeMethod, copy.failed, copy.noScope, granted, redirectUri, resource, state]);

  const deny = useCallback(() => {
    try {
      const target = new URL(redirectUri);
      target.searchParams.set("error", "access_denied");
      if (state) target.searchParams.set("state", state);
      window.location.replace(target.toString());
    } catch {
      setError(copy.invalid);
    }
  }, [copy.invalid, redirectUri, state]);

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen flex items-center justify-center px-6 py-24">
      <div className="w-full max-w-lg rounded-[34px] border border-stone-200/85 bg-white/70 p-7 md:p-9 shadow-[0_20px_48px_rgba(15,23,42,0.08)]">
        {children}
      </div>
    </div>
  );

  if (loading || (session && adminLoading)) {
    return shell(<p className="text-sm font-sans text-muted-foreground animate-pulse">{copy.checking}</p>);
  }

  if (!paramsValid) {
    return shell(<p className="text-sm font-sans text-destructive">{copy.invalid}</p>);
  }

  if (!session) {
    // La query intera va conservata: senza i parametri OAuth, tornare qui dopo
    // il login non servirebbe a niente.
    const returnUrl = `${window.location.origin}${window.location.pathname}${window.location.search}`;
    return shell(
      <div className="space-y-5">
        <p className="text-sm font-sans text-muted-foreground">{copy.needLogin}</p>
        <Button
          type="button"
          className="rounded-full"
          onClick={() => window.location.assign(`${getLoginUrl("/login")}?redirect=${encodeURIComponent(returnUrl)}`)}
        >
          {copy.login}
        </Button>
      </div>,
    );
  }

  if (!isAdmin) {
    return shell(<p className="text-sm font-sans text-destructive">{copy.notAdmin}</p>);
  }

  return shell(
    <div className="space-y-6">
      <div>
        <p className="text-[11px] font-sans uppercase tracking-[0.28em] text-muted-foreground mb-2">{copy.eyebrow}</p>
        <h1 className="editorial-heading text-2xl md:text-3xl flex items-center gap-3">
          <Bot size={22} className="text-accent" />
          {copy.title}
        </h1>
        <p className="mt-3 text-sm font-sans text-muted-foreground leading-relaxed">
          {copy.intro(clientName || clientId)}
        </p>
      </div>

      <div className="rounded-[24px] border border-white/60 bg-white/68 p-5">
        <p className="text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground mb-3">
          {copy.permissions}
        </p>
        <div className="space-y-2">
          {requestedScopes.map((scope) => {
            const selected = granted.includes(scope);
            return (
              <label key={scope} className="flex items-center gap-3 text-sm font-sans text-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() =>
                    setGranted((prev) => (prev.includes(scope) ? prev.filter((item) => item !== scope) : [...prev, scope]))
                  }
                  className="h-4 w-4 rounded border-border accent-[hsl(var(--accent))]"
                />
                {SCOPE_LABELS[scope]?.[lang === "en" ? "en" : "it"] ?? scope}
              </label>
            );
          })}
        </div>
        <p className="mt-3 text-xs font-sans text-muted-foreground">{copy.hint}</p>
      </div>

      <p className="flex items-start gap-2 text-xs font-sans text-muted-foreground leading-relaxed">
        <ShieldCheck size={14} className="mt-0.5 shrink-0 text-accent" />
        {copy.note}
      </p>

      {error && <p className="text-sm font-sans text-destructive">{error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={() => void approve()} disabled={submitting} className="rounded-full">
          {submitting ? <Loader2 size={15} className="animate-spin" /> : null}
          {submitting ? copy.approving : copy.approve}
        </Button>
        <Button type="button" variant="ghost" onClick={deny} disabled={submitting} className="rounded-full">
          {copy.deny}
        </Button>
      </div>
    </div>,
  );
};

export default AdminMcpAuthorize;
