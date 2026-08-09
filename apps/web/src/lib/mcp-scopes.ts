/**
 * Fonte unica degli scope del server MCP admin (`/api/mcp`): elenco, tipo ed
 * etichette bilingui.
 *
 * Sia il server (`server/mcp/context.ts`, validazione e rate limit) sia le
 * due UI che ne mostrano l'elenco a un umano — creazione token in
 * `AdminMcpTokens.tsx` e consenso OAuth in `AdminMcpAuthorize.tsx` —
 * importano da qui. Un nuovo scope aggiunto in questo file compare da solo in
 * entrambe le schermate: non c'è un secondo elenco da tenere allineato a
 * mano, quindi non può restare indietro come è successo la prima volta.
 */

export const MCP_SCOPES = [
  "articles:read",
  "articles:write",
  "plan:read",
  "plan:write",
  "newsletter:read",
  "newsletter:write",
  "mail:read",
  "mail:write",
  "voyages:read",
  "voyages:write",
] as const;

export type McpScope = (typeof MCP_SCOPES)[number];

export function isMcpScope(value: string): value is McpScope {
  return (MCP_SCOPES as readonly string[]).includes(value);
}

/** Etichetta mostrata all'admin, sia in fase di creazione token sia sulla pagina di consenso OAuth. */
export const MCP_SCOPE_LABELS: Record<McpScope, { it: string; en: string }> = {
  "articles:read": { it: "Leggere gli articoli", en: "Read articles" },
  "articles:write": { it: "Scrivere e modificare articoli", en: "Write and edit articles" },
  "plan:read": { it: "Leggere il piano editoriale", en: "Read the editorial plan" },
  "plan:write": { it: "Programmare nel piano editoriale", en: "Schedule in the editorial plan" },
  "newsletter:read": { it: "Leggere le newsletter", en: "Read newsletters" },
  "newsletter:write": { it: "Scrivere e schedulare newsletter", en: "Write and schedule newsletters" },
  "mail:read": { it: "Leggere la posta", en: "Read mail" },
  "mail:write": { it: "Rispondere, inoltrare e scrivere mail", en: "Reply, forward and write mail" },
  "voyages:read": { it: "Leggere le rotte e le tappe", en: "Read voyages and stops" },
  "voyages:write": {
    it: "Modificare rotte e tappe (nomi, descrizioni, POI, attività, foto)",
    en: "Edit voyages and stops (names, descriptions, POIs, activities, photos)",
  },
};

/**
 * Etichetta di uno scope letto da altrove (es. `scopes` di un token già
 * salvato in DB, non tipizzato): se non è più fra quelli noti mostra lo scope
 * grezzo invece di andare in errore — un token vecchio con uno scope rimosso
 * resta leggibile.
 */
export function mcpScopeLabel(scope: string, lang: "it" | "en"): string {
  return isMcpScope(scope) ? MCP_SCOPE_LABELS[scope][lang] : scope;
}

/** Scope proposti/selezionati di default alla creazione di un token o all'apertura del consenso OAuth. */
export const DEFAULT_MCP_SCOPES: McpScope[] = [
  "articles:read",
  "articles:write",
  "plan:read",
  "plan:write",
  "newsletter:read",
  "mail:read",
  "voyages:read",
  "voyages:write",
];
