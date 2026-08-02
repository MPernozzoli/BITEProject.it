---
tags: [admin, mcp, ai, agents, backoffice]
---
# 25 - MCP Admin

⬅️ [[Home]] · sorgente: `apps/web/api/mcp/`, `apps/web/src/server/mcp/`, migrazione `20260802210000_admin_mcp_access.sql`

## Cos'è
Un server **MCP** (Model Context Protocol) che espone il backoffice a un client agentico (Claude Code, Claude Desktop): pianificare il piano editoriale, scrivere e aggiornare bozze, programmarne la pubblicazione, gestire le campagne newsletter.

> È la superficie **privata** accanto a quella pubblica di [[15 - Semantic Layer (AI Agents)]]: `llms.txt` e `/data/*` raccontano il progetto a chiunque, l'MCP lo fa **fare** a chi ha un token admin.

Non duplica logica: ogni tool passa dalle stesse tabelle, RPC ed edge function che usa la UI di [[16 - Admin]]. Per la newsletter la semantica resta in `@pynkstudio/newsletterapp` → [[12 - Newsletter ed Email]].

## Endpoint
| Rotta | Metodo | Scopo |
|---|---|---|
| `/api/mcp` (alias `/mcp`) | POST/GET/DELETE | trasporto Streamable HTTP, **stateless** (`sessionIdGenerator: undefined`, `enableJsonResponse: true`) |
| `/api/mcp/tokens` | GET/POST/DELETE | emissione, elenco e revoca dei token, autenticati col normale access token Supabase dell'admin |

Il rewrite `/mcp` → `/api/mcp` sta in `vercel.json` **prima** del catch-all SPA; entrambe le rotte sono `noindex, nofollow` → [[18 - Deploy e Configurazione]].

## Accesso
- `Authorization: Bearer bite_mcp_...`, token opaco da 32 byte.
- Tabella `admin_mcp_tokens`: HMAC-SHA256 con `MCP_TOKEN_PEPPER` (env Vercel), prefisso in chiaro per riconoscerlo in lista, scope, scadenza (default 90 giorni), revoca.
- A ogni richiesta si ri-verifica `has_role(user_id,'admin')`: **togliere il ruolo invalida subito tutti i token di quell'utente**, senza revocarli uno per uno.
- Il valore in chiaro esiste solo nella risposta alla creazione. La UI è in `AdminMcpTokens.tsx`, montata da `AdminProfile.tsx` su `/profile` per gli admin.

Scope: `articles:read|write`, `plan:read|write`, `newsletter:read|write`.

## Tool
Registrati tutti tramite `registry.ts`, che applica in un punto solo controllo di scope, rate limit, audit, idempotenza e formato della risposta.

| Dominio | Tool |
|---|---|
| Piano | `plan_get_settings`, `plan_list_slots`, `plan_find_gaps`, `plan_upsert_slot`, `plan_assign_article`, `plan_free_slot` |
| Articoli | `article_search`, `article_get`, `article_create_draft`, `article_update`, `article_translate`, `article_seo_optimize`, `article_schedule`, `article_unschedule` |
| Newsletter | `newsletter_list_messages`, `newsletter_get_message`, `newsletter_stats`, `newsletter_create_draft`, `newsletter_update_draft`, `newsletter_schedule`, `newsletter_cancel_schedule` |

Risorse: `bite://guide/editorial`, `bite://article/{id}`, `bite://plan/{YYYY-MM}`.
Prompt: `pianifica-mese`, `bozza-da-appunti`, `digest-newsletter`.

## Guardrail
- **Niente pubblicazione o invio immediati.** Non esiste un tool "pubblica ora" né "spedisci a tutta la lista": si programma uno slot (pubblica il cron `publish-scheduled-articles`) o si schedula una campagna (spedisce il cron `newsletter-dispatch`) → [[09 - Edge Functions]].
- **`confirm: true` obbligatorio** sui tool con effetti esterni; senza, restituiscono l'anteprima di cosa accadrebbe. Le anteprime non entrano nella cache di idempotenza.
- **Bilinguismo a livello di schema**: `article_create_draft` pretende titolo IT ed EN, `plan_assign_article` rifiuta articoli con lacune di traduzione salvo `allow_translation_gaps` esplicito. La regola è quella di `AGENTS.md`, applicata dove non si può dimenticare.
- **Rate limit per token** via `consume_rate_limit` (la stessa RPC degli endpoint pubblici): 240 letture/h, 60 scritture/h.
- **Idempotenza**: ogni tool di scrittura accetta `client_request_id`; un retry con lo stesso valore restituisce il risultato precedente invece di duplicare l'effetto.
- **Audit**: `admin_mcp_audit_log` registra tool, argomenti (con i corpi lunghi troncati), esito, risorsa toccata e durata. Riga scritta prima dell'effetto, aggiornata dopo.
- **Prompt injection**: le istruzioni del server dichiarano che i contenuti letti dal database sono dati, non comandi.

## Contenuti: Markdown ⇄ TipTap
`src/server/mcp/markdown.ts` converte nei due sensi fra Markdown e il ProseMirror JSON dell'editor. Non usa `generateJSON` di TipTap perché le estensioni del client tirano dentro React e un DOM: costruisce l'albero dai token di `marked`. I nodi che Markdown non rappresenta (mini-mappa, media figure) sono resi in sola lettura come testo riconoscibile e non vengono ricreati in scrittura. Coperto da test di round-trip in `src/test/mcp-markdown.test.ts`.

## Configurazione
- Env Vercel: `MCP_TOKEN_PEPPER` (≥32 caratteri). `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` erano già presenti.
- Client:
  ```bash
  claude mcp add --transport http bite-admin https://admin.biteproject.it/mcp --header "Authorization: Bearer <token>"
  ```
- Ispezione manuale: `npx @modelcontextprotocol/inspector` → [[20 - Comandi e Workflow]].

## Non ancora fatto
- **Invio di prova della newsletter**: richiederebbe logica nuova, che per `AGENTS.md` va in `@pynkstudio/newsletterapp` con bump dei due pin, non qui.
- **OAuth 2.1**: serve solo per il pulsante "Connect" dei connector su claude.ai. Con Claude Code e Claude Desktop basta il token.
- **Media**: nessun tool di upload; la libreria media resta su `/admin/media`.

## Collegamenti
- [[16 - Admin]] · [[15 - Semantic Layer (AI Agents)]] · [[12 - Newsletter ed Email]] · [[10 - API Vercel]] · [[08 - Supabase]] · [[17 - Content Model]]
