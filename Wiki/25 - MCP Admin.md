---
tags: [admin, mcp, ai, agents, backoffice]
---
# 25 - MCP Admin

⬅️ [[Home]] · sorgente: `apps/web/api/mcp/`, `apps/web/src/server/mcp/`, migrazione `20260802210739_admin_mcp_access.sql`

## Cos'è
Un server **MCP** (Model Context Protocol) che espone il backoffice a un client agentico (Claude Code, Claude Desktop): pianificare il piano editoriale, scrivere e aggiornare bozze, programmarne la pubblicazione, gestire le campagne newsletter, gestire le storie (serie di articoli) e consultare le metriche di engagement.

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

Scope: `articles:read|write`, `analytics:read`, `plan:read|write`, `newsletter:read|write`, `mail:read|write`, `stories:read|write`, `voyages:read|write`. Elenco, tipo ed etichette bilingui vivono in un solo punto, `src/lib/mcp-scopes.ts`: sia la UI di creazione token (`AdminMcpTokens.tsx`) sia la pagina di consenso OAuth (`AdminMcpAuthorize.tsx`) lo importano invece di tenere un proprio elenco, quindi mostrano sempre gli stessi permessi e uno scope nuovo compare in entrambe senza toccarle. `Record<McpScope, …>` obbliga anche a dargli un'etichetta: dimenticarla è un errore di build (`tsc`), non un buco silenzioso scoperto in produzione — cosa già successa una volta con `voyages:*`, aggiunto allo scope server ma non alla pagina di consenso finché non consolidata qui.

### OAuth 2.1 (connector claude.ai)
Un client come Claude Code punta direttamente col token manuale; un connector browser (claude.ai) non sa mandare un header custom e si aspetta un authorization server. Per quel caso c'è un AS minimale, tutto in `apps/web/api/mcp/oauth/` + `src/server/mcp/oauth.ts`:

| Endpoint | Scopo |
|---|---|
| `/.well-known/oauth-authorization-server` | metadata RFC 8414 (rewrite → `oauth/metadata.ts`) |
| `/.well-known/oauth-protected-resource` | metadata RFC 9728, puntato dall'header `WWW-Authenticate` del 401 di `/api/mcp` |
| `POST /api/mcp/oauth/register` | dynamic client registration (RFC 7591), pubblica e rate-limitata per IP; solo client pubblici (`token_endpoint_auth_method: none`) |
| `GET /api/mcp/oauth/authorize` | valida client/redirect_uri/PKCE, poi redirige a `/admin/mcp/authorize` |
| `/admin/mcp/authorize` (`AdminMcpAuthorize.tsx`) | pagina di consenso nella SPA: l'admin vede chi chiede accesso e sceglie gli scope |
| `POST /api/mcp/oauth/approve` | chiamato dalla pagina di consenso con la sessione Supabase dell'admin; unico punto che emette l'authorization code |
| `POST /api/mcp/oauth/token` | scambia code+PKCE per access/refresh token, o rinnova con rotazione |

**Chi autentica l'umano resta Supabase.** L'AS qui sopra non tocca l'auth: verifica solo che chi approva sia già loggato e admin, poi emette codice e token. I token OAuth sono righe di `admin_mcp_tokens` con `kind = oauth_access|oauth_refresh` (colonne aggiunte da `20260802213214_admin_mcp_oauth.sql`, insieme a `admin_mcp_oauth_clients` e `admin_mcp_oauth_codes`): stessa validazione, stesso audit, stessa revoca dei token manuali — non è una seconda specie di credenziale.

Guardrail specifici del flusso: PKCE S256 obbligatorio (niente client confidenziali), `redirect_uri` per confronto esatto contro quelli registrati (mai un redirect verso un URI non verificato), code monouso — un riuso revoca **tutta** l'autorizzazione di quel client per quell'utente, non solo il token, refresh token a rotazione (l'uso invalida quello precedente), binding alla risorsa (RFC 8707: un token per `/mcp` non vale su un altro server MCP), ruolo admin ricontrollato a ogni scambio/rinnovo.

## Tool
Registrati tutti tramite `registry.ts`, che applica in un punto solo controllo di scope, rate limit, audit, idempotenza e formato della risposta.

| Dominio | Tool |
|---|---|
| Piano | `plan_get_settings`, `plan_list_slots`, `plan_find_gaps`, `plan_upsert_slot`, `plan_assign_article`, `plan_free_slot` |
| Articoli | `article_search`, `article_get`, `article_create_draft`, `article_update`, `article_translate`, `article_seo_optimize`, `article_schedule`, `article_unschedule`, `article_upload_image` |
| Metriche | `article_metrics` (aggregate), `article_metrics_detail` (singolo articolo con serie giornaliera) |
| Storie | `story_search`, `story_get`, `story_create`, `story_update`, `story_delete`, `story_assign_article`, `story_remove_article` |
| Newsletter | `newsletter_list_messages`, `newsletter_get_message`, `newsletter_stats`, `newsletter_create_draft`, `newsletter_update_draft`, `newsletter_schedule`, `newsletter_cancel_schedule`, `newsletter_upload_image` |
| Mail | `mail_list_messages`, `mail_get_message`, `mail_mark`, `mail_reply`, `mail_forward`, `mail_compose` |
| Viaggi | `voyage_search`, `voyage_get`, `voyage_waypoint_update`, `voyage_waypoint_upload_image` |

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

## Mail
I tool `mail_*` non toccano `apps/web/api/email/*`: chiamano direttamente le funzioni esportate da `@pynkstudio/mailapp/mailbox/server` (`loadMailbox`, `applyMailMessageAction`, `sendMailboxMessage`, `attachThreadMessages`) — la stessa libreria dietro quegli endpoint HTTP, non una sua reimplementazione, coerente con `AGENTS.md`. `mail_list_messages`/`mail_get_message` leggono; `mail_mark` gestisce (letto/stella/archivio/spam) senza `confirm` salvo `delete`, che cancella la riga; `mail_reply`/`mail_forward`/`mail_compose` spediscono davvero tramite Resend e stanno dietro `confirm: true` come ogni altro tool ⚠ — sono gli unici tool mail con un effetto che esce dal sistema. Il forward non prosegue il thread originale (niente `replyToMessageId`): è un nuovo messaggio con l'originale citato in corpo, senza allegati.

## Contenuti: Markdown ⇄ TipTap
`src/server/mcp/markdown.ts` converte nei due sensi fra Markdown e il ProseMirror JSON dell'editor. Non usa `generateJSON` di TipTap perché le estensioni del client tirano dentro React e un DOM: costruisce l'albero dai token di `marked`. Copre la formattazione che offre l'editor — grassetto, corsivo, sottolineato (`<u>`), codice inline e a blocco, titoli h1-h3, liste puntate/numerate, tabelle GFM, citazioni, separatori, link — e le foto: `![alt](url)` diventa un'immagine, `![alt](url "didascalia")` (sintassi Markdown standard per il titolo) diventa un nodo `mediaFigure` con didascalia, lo stesso con cui l'editor mostra foto captionate. Le tabelle hanno la prima riga resa come intestazione (`th`) e si usano dai tool articoli con la normale sintassi Markdown a barre. I nodi che Markdown non rappresenta comunque (mini-mappa) restano resi in sola lettura come testo riconoscibile. Coperto da test di round-trip in `src/test/mcp-markdown.test.ts`.

Per la newsletter la stessa fedeltà arriva gratis: `newsletter_create_draft`/`update_draft` passano il corpo Markdown per `marked.parse()`, che produce HTML vero (`<strong>`, `<h2>`, `<ul>`, `<img>`...) salvato in modalità `html`, la stessa che la console admin già gestisce per i corpi scritti fuori dall'editor rich text.

## Foto
`src/server/mcp/media.ts` scarica un'immagine da un URL https e la ripubblica nel bucket **`logbook-media`** — lo stesso dell'upload manuale in `ArticleEditor.tsx` e in `AdminNewsletterManager.tsx` — invece di lasciare l'articolo a puntare verso un dominio esterno e fragile. Limiti: solo https, solo JPG/PNG/WEBP/GIF, 12MB. `article_upload_image` (cartella default `articles`, usa `covers` per le cover) e `newsletter_upload_image` (cartella default `newsletter`) restituiscono l'URL pubblico da usare come `cover_image` o dentro il corpo Markdown.

## Tappe dei viaggi
`src/server/mcp/tools/voyages.ts` copre il contenuto narrativo di una tappa (`voyage_waypoints`) — cioè esattamente ciò che compare su `/voyages/:id`: nome, descrizione, punti di interesse, attività previste e foto, in entrambe le lingue dove applicabile. Non copre la geometria del percorso (lat/lng, ordine delle tappe, date di transito, durata soste): quella resta nell'editor mappa di `AdminVoyageManager.tsx`, dove spostare una tappa si fa guardando la rotta disegnata, non alla cieca da un agente.

`voyage_search`/`voyage_get` leggono; `voyage_waypoint_update` scrive nome/descrizione/POI/attività/media come patch parziale — `poi`, `activities` e `media`, quando passati, **sostituiscono** l'elenco esistente, non lo sommano, stessa semantica "cancella e riscrivi" di tag/autori sugli articoli. `voyage_waypoint_upload_image` scarica un'immagine da URL e la ripubblica nel bucket `logbook-media` (cartella `voyages`) come `article_upload_image`; passando `waypoint_id` la aggiunge subito alla galleria della tappa senza toccare le foto già presenti — il modo pensato per "metti la foto della città" senza dover ripassare tutto l'array `media`.

## Configurazione
- Env Vercel: `MCP_TOKEN_PEPPER` (≥32 caratteri). `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` erano già presenti.
- Client:
  ```bash
  claude mcp add --transport http bite-admin https://admin.biteproject.it/mcp --header "Authorization: Bearer <token>"
  ```
- Ispezione manuale: `npx @modelcontextprotocol/inspector` → [[20 - Comandi e Workflow]].

## Impostazioni articolo coperte
`article_create_draft`/`article_update` non toccano solo il corpo: cover con punto focale (`cover_focal_x/y`) e zoom (`cover_zoom`), slug bilingui SEO (`slug_it`/`slug_en`, indicizzati unique case-insensitive — un duplicato torna come errore DB leggibile), tag (per nome: risolti su quelli esistenti o creati al volo, **sostituiscono** l'elenco esistente quando passati, non lo sommano — stessa semantica "cancella e riscrivi" di `ArticleEditor.tsx`), autori (`{profile_id, role}`, stessa sostituzione, il profilo deve già esistere), collegamento voyage/waypoint/segmento, posizione (`location_name`/`latitude`/`longitude`). `article_get` li restituisce tutti, tag inclusi per nome.

## Metriche articoli
`article_metrics` e `article_metrics_detail` chiamano le RPC admin `admin_article_view_insights` e `admin_article_view_insight_one` (definite in `20260809090000_article_likes_anonymous_and_engagement_kpis.sql`). Restituiscono: visualizzazioni totali e tracciate, visitatori unici (registrati + anonimi), tempo medio di lettura, distribuzione per lingua (IT/EN), likes (registrati + anonimi), commenti, serie giornaliera degli ultimi 30 giorni. Lo scope è `analytics:read`.

## Storie
`story_*` gestisce la tabella `stories`: serie di articoli collegati via `logbook_articles.story_id` (FK nullable). Una story ha titolo e descrizione bilingue, slug bilingui (unique case-insensitive), cover, `type` (`open`|`closed`) e `target_chapter_count` (nullable). `story_assign_article`/`story_remove_article` impostano/rimuovono `story_id` sugli articoli — l'articolo non viene mai eliminato, solo scollegato. `story_delete` elimina la story e scollega gli articoli (con `confirm: true`). Scope: `stories:read|write`.

## Non ancora fatto
- **Invio di prova della newsletter**: richiederebbe logica nuova, che per `AGENTS.md` va in `@pynkstudio/newsletterapp` con bump dei due pin, non qui.
- **Libreria media**: i tool caricano un'immagine puntuale nel bucket, non gestiscono la libreria (`/admin/media`) né creano profili autore.

## Collegamenti
- [[16 - Admin]] · [[15 - Semantic Layer (AI Agents)]] · [[12 - Newsletter ed Email]] · [[10 - API Vercel]] · [[08 - Supabase]] · [[17 - Content Model]]
