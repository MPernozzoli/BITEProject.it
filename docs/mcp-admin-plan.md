# MCP admin BITE — struttura proposta e piano di sviluppo

Data: 2026-08-02 · Sorgenti lette: `apps/web/src/pages/Admin*.tsx`, `apps/web/src/components/admin/*`, `apps/web/src/lib/editorial-plan.ts`, `apps/web/api/**`, `apps/web/supabase/functions/**`, `apps/web/supabase/migrations/20260802180000_newsletter_campaign_schema.sql`, `vercel.json`, `AGENTS.md`, `Wiki/12`, `Wiki/15`, `Wiki/16`.

> **Premessa sull'interpretazione.** Ho letto "MPC" come **MCP server** (Model Context Protocol): un'interfaccia agent-facing sul backoffice, protetta da login admin, che permette a Claude (Desktop / Code / claude.ai) di pianificare il piano editoriale, preparare bozze, editare e schedulare articoli e gestire le newsletter.
> Il motivo è che **il CMS che descrivi esiste già** ed è completo: `admin.biteproject.it` con `AdminRoute` + `has_role('admin')`, piano editoriale (`AdminEditorialPlan` + `editorial_plan_slots`), editor TipTap (`ArticleEditor.tsx`, 2973 righe), schedulazione via slot + cron `publish-scheduled-articles`, composer newsletter (`AdminNewsletterManager` su `@pynkstudio/newsletterapp/admin`) e dispatch cron ogni 5 minuti.
> Quindi il valore non è ricostruire quelle superfici, è **renderle pilotabili da un agente**. Se invece intendevi estendere il CMS esistente, vedi §10: cambia il piano, non l'analisi.

---

## Stato implementazione (2026-08-02)

Implementato e verificato in locale: `tsc` pulito sui file nuovi, lint pulito, 34 test dedicati verdi (suite completa 161/162 — l'unico rosso è `candidate-info-form`, preesistente e non toccato da questo lavoro), build Vite ok, `deno check` ok sulla function modificata. Migrazione **applicata in produzione**.

| Fase | Stato | Dove |
|---|---|---|
| 0 · Verifica schema + spike transport | ✅ | schema reale confermato via SQL su `ekwloweuicrqjjgabfdp` |
| 1 · Trasporto, auth token, audit | ✅ | `api/mcp/index.ts`, `api/mcp/tokens.ts`, `src/server/mcp/{auth,audit,registry,context}.ts`, migrazione `20260802210000` |
| 2 · Tool read-only + resources + prompts | ✅ | `src/server/mcp/tools/*`, `server.ts` |
| 3 · Scrittura articoli + Markdown⇄TipTap | ✅ | `src/server/mcp/markdown.ts`, `tools/articles.ts` |
| 4 · Piano editoriale e schedulazione | ✅ | `tools/plan.ts` |
| 5 · Newsletter | ✅ salvo invio di prova | `tools/newsletter.ts`, tutto sopra `@pynkstudio/newsletterapp/admin` |
| 6 · OAuth 2.1 | ⏸️ non fatto | serve solo per il pulsante "Connect" su claude.ai |
| 7 · UI token, test, Wiki | ✅ | `AdminMcpTokens.tsx`, `src/test/mcp-*.test.ts`, `Wiki/25 - MCP Admin.md` |

Scostamenti dal piano, e perché:

- **`newsletter_send_test` non c'è.** Un invio di prova è logica nuova del dominio newsletter e per `AGENTS.md` va scritta in `@pynkstudio/newsletterapp`, con bump dei due pin e un tag pubblicato: è un rilascio del package, non una modifica di questa repo.
- **`markdownToTiptap` non usa TipTap.** Le estensioni del client importano React (`MediaFigure` ha un node view) e vogliono un DOM: in una function serverless costruire l'albero dai token di `marked` è più leggero e testabile. Round-trip coperto da test.
- **Una modifica fuori dal perimetro MCP:** `translate-editor-content` ora accetta anche la service key iniettata (`isInjectedServiceKey`, lo helper che esisteva già per questo). Senza, `article_translate` avrebbe preso 401 con la key opaca `sb_secret_...`.

---

## 0. Sintesi in una pagina

Un endpoint MCP unico — `https://admin.biteproject.it/mcp` — servito da una Vercel Function Node (Fluid) accanto alle altre in `apps/web/api/`, in modalità **stateless** (nessuna sessione da conservare tra invocazioni serverless).

Tre decisioni che reggono tutto il resto:

1. **L'MCP non è un secondo backend.** Ogni tool chiama le stesse tabelle, RPC ed edge function che usa la UI admin. Zero logica di dominio duplicata: se un comportamento manca, si aggiunge dove già vive (repo per gli articoli, `@pynkstudio/newsletterapp` per la newsletter, come impone `AGENTS.md`).
2. **L'MCP non spedisce e non pubblica "adesso".** Può creare, editare, tradurre e **schedulare**. La pubblicazione resta del cron `publish-scheduled-articles`, l'invio newsletter resta del cron `newsletter-dispatch`. Questo è esattamente ciò che hai chiesto ("pubblicare inteso come schedulare") ed è anche il guardrail più efficace contro un agente che sbaglia: il peggio che può fare è mettere in calendario qualcosa di rimuovibile prima che parta.
3. **L'autenticazione è per token admin revocabile**, emesso dalla UI admin dopo il normale login Supabase (OTP/OAuth/passkey), non una service key incollata in un file di config. Fase 6 opzionale: OAuth 2.1 completo se vuoi il pulsante "Connect" dei connector claude.ai.

Ordine di lavoro: **Fase 0** verifica (0,5 g) → **Fase 1** trasporto + auth + audit (2 g) → **Fase 2** tool read-only (1,5 g) → **Fase 3** scrittura articoli (3 g) → **Fase 4** piano editoriale + schedulazione (2 g) → **Fase 5** newsletter (2 g, lavoro nel package) → **Fase 6** OAuth per claude.ai (2 g, opzionale) → **Fase 7** hardening, test, Wiki, deploy (1,5 g).
Totale ~12,5 giornate senza Fase 6, ~14,5 con.

---

## 1. Cosa esiste già e va solo esposto

| Capacità | Dove vive oggi | Note per l'MCP |
|---|---|---|
| Ruolo admin | RPC `has_role(_user_id, _role)`; `AdminRoute.tsx`, `_shared/social-oauth-auth.ts` | stesso check lato server, nessun ruolo nuovo |
| Articoli | tabella `logbook_articles` (`status` draft/scheduled/published, `scheduled_at`, campi IT/EN), `ArticleEditor.tsx` | corpo in TipTap JSON + HTML sanitizzato → §4.1 |
| Piano editoriale | `editorial_plan_slots`, `editorial_plan_settings`, canali fissi in `src/lib/editorial-plan.ts`; trigger che imposta `status=scheduled` + `scheduled_at` all'assegnazione dello slot | la schedulazione **è** l'assegnazione dello slot: l'MCP non deve scrivere `scheduled_at` a mano |
| Pubblicazione | edge function `publish-scheduled-articles` (cron) | l'MCP non la bypassa |
| Traduzione IT/EN | edge function `translate-editor-content` (OpenAI server-side) | riusata da un tool, non riscritta |
| SEO IA | edge function `optimize-article-seo` | esposta in sola lettura + trigger manuale |
| Newsletter | `newsletter_messages/events/deliveries`, cron `newsletter-dispatch`, `send-newsletter-digest`, logica in `@pynkstudio/newsletterapp` | vincolo `AGENTS.md`: logica nel package → §4.3 |
| Media | `AdminMedia.tsx`, storage buckets, `admin-media-upload-queue.ts` | fuori scope v1, candidato v2 |
| Rate limit | migrazione `20260725101000_public_endpoint_rate_limits.sql` | pattern riusabile per l'MCP |

---

## 2. Architettura

### 2.1 Trasporto e collocazione

- **Endpoint:** `POST/GET/DELETE /api/mcp`, con rewrite di cortesia `/mcp` → `/api/mcp` in `vercel.json` (va inserito **prima** del catch-all `/((?!.*\.[^/]+$).*)`, l'ordine conta).
- **Runtime:** Vercel Function Node 24 su Fluid Compute, `maxDuration` 300. Stesso stile handler `NodeRequest`/`NodeResponse` già usato in `api/auth/verify.ts` e `api/email/*`.
- **SDK:** `@modelcontextprotocol/sdk` con `StreamableHTTPServerTransport` in modalità **stateless** (`sessionIdGenerator: undefined`): server e transport creati per richiesta, `handleRequest(req, res, body)` accetta direttamente req/res Node. Nessuna sessione condivisa → nessun Redis in v1.
- **Header:** `X-Robots-Tag: noindex, nofollow` su `/mcp` come già per `/admin/*`.

### 2.2 Autenticazione — token admin revocabili (v1)

Nuova migrazione, tabella `admin_mcp_tokens`:

| colonna | tipo | scopo |
|---|---|---|
| `id` | uuid pk | |
| `user_id` | uuid → `auth.users` | l'admin proprietario |
| `name` | text | "MacBook Claude Code", per riconoscerlo |
| `token_hash` | text | SHA-256 di `pepper + token`; il token in chiaro è mostrato **una sola volta** |
| `scopes` | text[] | `articles:read`, `articles:write`, `plan:write`, `newsletter:write`… |
| `expires_at` | timestamptz | default 90 giorni |
| `last_used_at`, `revoked_at` | timestamptz | |

Flusso: l'admin fa il login normale su `admin.biteproject.it` → nuova sezione **Profilo → Accesso agenti** → genera token con scope e scadenza → lo incolla nel client MCP. RLS: ogni admin vede e revoca solo i propri token; la validazione lato server usa service role.

Ad ogni richiesta il server: estrae `Authorization: Bearer`, confronto **a tempo costante** sull'hash (stesso approccio di `_shared/service-auth.ts`), verifica `revoked_at`/`expires_at`, ri-verifica `has_role(user_id,'admin')` — così togliere il ruolo admin invalida subito i token — aggiorna `last_used_at`.

In assenza o invalidità del token: `401` + header `WWW-Authenticate` con il puntamento a `/.well-known/oauth-protected-resource` (già conforme, così la Fase 6 non rompe i client).

### 2.3 Autorizzazione ed esecuzione

Due client Supabase per richiesta:

- **client utente** (JWT scambiato o service role con `request.jwt.claims` impostati) per tutto ciò che le RLS admin già coprono → le policy restano l'ultima linea di difesa;
- **service role** solo dove la UI admin stessa passa da edge function (traduzione, SEO, dispatch).

Ogni tool dichiara gli scope richiesti; scope mancante → errore MCP esplicito, non silenzioso.

### 2.4 Audit e rate limit

- Tabella `admin_mcp_audit_log`: `id`, `token_id`, `user_id`, `tool`, `arguments` (jsonb, con redazione dei corpi lunghi), `outcome` (`ok`/`error`/`denied`), `error`, `target_id`, `duration_ms`, `created_at`. Scritta **prima** dell'effetto per le write, aggiornata dopo.
- Rate limit per token sul modello di `public_endpoint_rate_limits`: default 120 chiamate/ora, 20/ora per i tool di scrittura, 5/ora per `newsletter_send_test`.
- Idempotenza: ogni tool di scrittura accetta `client_request_id`; stesso id entro 10 minuti → si restituisce il risultato precedente invece di duplicare (i client MCP ritentano).

---

## 3. Superficie MCP

### 3.1 Tools

Nomi in `snake_case` per dominio. `RO` = read-only, `W` = write, `⚠` = effetto visibile all'esterno.

**Piano editoriale**

| Tool | Tipo | Cosa fa |
|---|---|---|
| `plan_get_settings` | RO | mix pillar/support/utility, canali, timezone |
| `plan_list_slots` | RO | slot per intervallo di date e canale, con articolo assegnato e stato |
| `plan_find_gaps` | RO | buchi di calendario e scostamento dal mix target — l'input naturale per "pianificami il mese" |
| `plan_upsert_slot` | W | crea/sposta uno slot (data, ora, canale, tipo editoriale) |
| `plan_assign_article` | W ⚠ | assegna un articolo a uno slot → il trigger lo porta a `scheduled` |
| `plan_free_slot` | W | libera lo slot; deschedula solo se non pubblicato |

**Articoli**

| Tool | Tipo | Cosa fa |
|---|---|---|
| `article_search` | RO | filtri su stato, categoria, autore, voyage, testo, data |
| `article_get` | RO | articolo completo, incluse le lacune di traduzione (`article-translation-gaps.ts`) |
| `article_create_draft` | W | nuova bozza; richiede titolo IT **e** EN (§4.2) |
| `article_update` | W | patch parziale su corpo/metadati/cover/tag/autori |
| `article_translate` | W | invoca `translate-editor-content` per colmare il gap IT↔EN |
| `article_seo_optimize` | W | invoca `optimize-article-seo`; restituisce il record salvato |
| `article_schedule` | W ⚠ | scorciatoia: assegna il primo slot utile o uno indicato |
| `article_unschedule` | W | torna a `draft` se non ancora pubblicato |

**Newsletter**

| Tool | Tipo | Cosa fa |
|---|---|---|
| `newsletter_list_messages` | RO | campagne e automazioni con stato e metriche |
| `newsletter_get_message` | RO | contenuto multilingua e payload |
| `newsletter_create_draft` | W | bozza campagna; oggetto/preheader/corpo IT+EN |
| `newsletter_update_draft` | W | patch, con validazione del package |
| `newsletter_schedule` | W ⚠ | imposta `scheduled_at` → parte il cron |
| `newsletter_cancel_schedule` | W | torna a `draft` se non ancora accodata |
| `newsletter_send_test` | W ⚠ | invia **solo** all'indirizzo dell'admin proprietario del token |
| `newsletter_stats` | RO | iscritti, aperture, click, soppressioni |

**Non esiste** un tool "invia ora a tutta la lista": è deliberato, resta un gesto umano nella UI admin.

Ogni tool porta le annotazioni MCP corrette (`readOnlyHint`, `destructiveHint`, `idempotentHint`), e i tool marcati ⚠ richiedono `confirm: true` esplicito: senza, restituiscono un **preview** di cosa succederebbe (data, canale, destinatari stimati) invece di eseguire.

### 3.2 Resources

- `bite://article/{id}` — articolo in Markdown, leggibile senza chiamare tool
- `bite://plan/{yyyy-mm}` — calendario del mese in forma tabellare
- `bite://newsletter/{id}` — campagna renderizzata
- `bite://guide/editorial` — tono di voce, regole di mix, vincolo bilingue: il contesto che rende utili le bozze generate. Sorgente: le note `Wiki/17` e `Wiki/12`.

### 3.3 Prompts

`pianifica-mese` (parte da `plan_find_gaps`), `bozza-da-appunti` (appunti → bozza bilingue con cover e tag), `digest-newsletter` (articoli pubblicati nel periodo → bozza digest).

---

## 4. I nodi tecnici veri

### 4.1 Formato del corpo articolo
L'editor è **TipTap 3** con un set di estensioni preciso; il DB tiene JSON + HTML sanitizzato via `sanitize-rich-html.ts`. Un agente produce naturalmente Markdown. Serve un modulo condiviso `src/lib/article-content.ts` con `markdownToTiptap` / `tiptapToMarkdown`, costruito sullo **stesso array di estensioni dell'editor** (estratto in un modulo comune per non divergere) e con la sanitizzazione esistente applicata sempre in uscita. È il pezzo con più rischio di regressione: va coperto da test round-trip su articoli reali prima di collegarlo ai tool. Nodi non rappresentabili in Markdown (mini-mappa, media di viaggio, figure con caption) restano gestibili solo via tool dedicati o restano invariati nella patch.

### 4.2 Bilinguismo IT/EN
`AGENTS.md` lo impone su ogni superficie che raggiunge utenti reali. Traduzione a schema, non a documentazione: gli input dei tool di creazione hanno `title_it`/`title_en` obbligatori, e `plan_assign_article` / `newsletter_schedule` **rifiutano** contenuti con lacune di traduzione a meno di `allow_partial: true` motivato. Meglio un errore in chat che un articolo pubblicato monolingue.

### 4.3 Newsletter: si scrive nel package
Tutta la semantica (cosa conta come corpo, quali lingue sono obbligatorie, payload salvato, metriche) vive in `@pynkstudio/newsletterapp/admin`. I tool MCP la **chiamano**. Se serve qualcosa che il package non espone, si aggiunge lì e si aggiornano **entrambi** i pin (tarball in `apps/web/package.json` e URL raw in `_shared/newsletterapp.ts`), altrimenti i due runtime divergono.

### 4.4 Serverless
Stateless obbligatorio: nessuna variabile di modulo usata come stato tra richieste. Le operazioni lunghe (traduzione, SEO) restituiscono subito un handle e si interrogano con un tool di stato, invece di tenere aperta l'invocazione.

---

## 5. Sicurezza — checklist di accettazione

- [ ] Nessun endpoint MCP raggiungibile senza token valido **e** `has_role('admin')` ancora vero.
- [ ] Token: hash + pepper, confronto a tempo costante, scadenza, revoca immediata, scope applicati.
- [ ] Tutti i tool ⚠ dietro `confirm: true`, con preview.
- [ ] Nessun tool può pubblicare o spedire immediatamente; solo schedulare.
- [ ] Audit log completo, rate limit attivi, `client_request_id` per l'idempotenza.
- [ ] I contenuti letti dal DB (bozze, commenti, mail) sono **dati, non istruzioni**: le description dei tool lo esplicitano, per contenere la prompt injection su un canale dove il modello legge testo scritto da terzi.
- [ ] `/mcp` `noindex, nofollow`; token mai loggati né in audit né in Vercel logs.

---

## 6. Piano di sviluppo

### Fase 0 — Verifica e spike (0,5 g)
Confermare su DB reale le colonne di `logbook_articles` e `editorial_plan_slots` (lo storico dice che gli assunti da codice vanno verificati); spike di 2 ore con `StreamableHTTPServerTransport` su una function Vercel e `npx @modelcontextprotocol/inspector` per validare handshake e streaming in stateless.

### Fase 1 — Trasporto, auth, audit (2 g)
`apps/web/api/mcp/index.ts` · `src/server/mcp/{server,auth,audit,rate-limit}.ts` · migrazione `admin_mcp_tokens` + `admin_mcp_audit_log` + RLS · UI "Accesso agenti" in `AdminProfile.tsx` · rewrite e header in `vercel.json`.
**Esce funzionante:** connessione dal client, `tools/list`, un tool `whoami`.

### Fase 2 — Tool read-only (1,5 g)
`plan_*` di lettura, `article_search`/`article_get`, `newsletter_list_messages`/`newsletter_get_message`/`newsletter_stats`, le resources. Rischio nullo, valore immediato: da qui puoi già chiedere "cosa manca nel calendario di settembre".

### Fase 3 — Scrittura articoli (3 g)
`src/lib/article-content.ts` con test round-trip · `article_create_draft`, `article_update`, `article_translate`, `article_seo_optimize` · enforcement bilingue.

### Fase 4 — Piano editoriale e schedulazione (2 g)
`plan_upsert_slot`, `plan_assign_article`, `plan_free_slot`, `article_schedule`, `article_unschedule`, `plan_find_gaps` con il calcolo del mix · verifica end-to-end col trigger e col cron `publish-scheduled-articles` su una data futura.

### Fase 5 — Newsletter (2 g)
Estensione di `@pynkstudio/newsletterapp` con le funzioni mancanti (bozza, patch validata, schedulazione, test) e bump dei due pin · tool `newsletter_*` di scrittura · `newsletter_send_test` limitato all'indirizzo dell'admin.

### Fase 6 — OAuth 2.1 (2 g, opzionale)
Serve solo per il pulsante "Connect" dei connector su claude.ai: `/.well-known/oauth-protected-resource` e `/.well-known/oauth-authorization-server`, dynamic client registration, `authorize`/`token` con PKCE, login delegato a Supabase Auth. Con Claude Code e Claude Desktop il token della Fase 1 basta.

### Fase 7 — Hardening, test, documentazione, deploy (1,5 g)
Test vitest sui tool handler (auth negata, scope mancante, confirm mancante, idempotenza) · giro completo con MCP Inspector · nuova nota `Wiki/25 - MCP Admin.md` collegata da `Home.md`, `12`, `15`, `16`, `20` · migrazioni applicate.

---

## 7. Verifica

- `npm run test --workspace @biteproject/web` per i tool handler.
- `npx @modelcontextprotocol/inspector` contro dev e contro produzione (con token di test a scadenza breve).
- Prova end-to-end reale: bozza creata dall'agente → tradotta → assegnata a uno slot fra 24 ore → verifica che il cron la pubblichi e che la pagina pubblica sia corretta in entrambe le lingue.
- Nessuna modifica a edge function in questo piano; se ne toccheremo, `npx deno@2 check` come da `Wiki/20`.

---

## 8. Azioni richieste all'umano

1. **Confermare l'interpretazione** (MCP server vs estensione del CMS — §10).
2. **Env var su Vercel** (`vercel env add`, ambienti production + preview): `MCP_TOKEN_PEPPER` (32 byte random, lo genero io al momento della Fase 1). `SUPABASE_SERVICE_ROLE_KEY` e `SUPABASE_URL` sono già presenti.
3. **Generare il primo token** dalla UI admin dopo il deploy della Fase 1 (è l'unico momento in cui il valore è visibile).
4. **Configurare il client**, es. Claude Code:
   ```bash
   claude mcp add --transport http bite-admin https://admin.biteproject.it/mcp --header "Authorization: Bearer <token>"
   ```
5. **Decidere su Fase 6**: serve solo se vuoi usare l'MCP da claude.ai in browser.

---

## 9. Ricadute sul vault Obsidian

Nuova nota `Wiki/25 - MCP Admin.md` (accesso, tool, guardrail, token) collegata da `Home.md`; aggiornamenti a `16 - Admin` (sezione accesso agenti), `12 - Newsletter ed Email` (tool e cosa è finito nel package), `10 - API Vercel` (nuovo endpoint), `08 - Supabase` (nuove tabelle), `15 - Semantic Layer` (l'MCP è la superficie *privata* accanto a quella pubblica `llms.txt`/`/data/*`), `20 - Comandi e Workflow` (Inspector).

---

## 10. Se invece intendevi estendere il CMS

L'analisi resta valida, cambia il backlog. Rispetto a ciò che chiedi, il CMS oggi copre già piano editoriale, bozze, editor, schedulazione e newsletter; i buchi realistici sono: assenza di uno stato di **revisione** fra `draft` e `scheduled` (oggi si passa direttamente), nessuna **anteprima condivisibile** di una bozza, nessuna **cronologia versioni** dell'articolo, nessuna **conferma prima dell'invio a tutta la lista** newsletter e nessuna **segmentazione** (entrambe già indicate come mancanti in `docs/newsletter-improvement-plan.md`, Fase 3). Dimmelo e riscrivo il piano su quelle voci.
