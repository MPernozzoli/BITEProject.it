---
tags: [deploy, vercel, config, env]
---
# 18 - Deploy e Configurazione

⬅️ [[Home]] · sorgente: `vercel.json`, `middleware.ts` (root), `.env`, `apps/web/vite.config.ts`

## Hosting
- **Vercel** (cartella `.vercel/`). Frontend SPA da `apps/web` + Vercel Functions (`api` symlink a `apps/web/api`) → [[10 - API Vercel]].
- Backend dati/logica su [[08 - Supabase]].

## `vercel.json`
**Rewrites:**
- `/mcp` → `/api/mcp` (server MCP admin → [[25 - MCP Admin]]; deve stare **prima** del fallback SPA, l'ordine conta)
- `/llms.txt` → `/api/llms`
- `/llms-full.txt` → `/api/llms?full=1`
- `/sitemap-live.xml` → `/api/sitemap`
- `/pack/((?!.*\.[^/]+$).*)` → `/pack/index.html`
- `/Data/((?!.*\.[^/]+$).*)` → `/Data/index.html`
- `/Crew/((?!.*\.[^/]+$).*)` → `/Crew/index.html`
- `/((?!.*\.[^/]+$).*)` → `/` (SPA fallback, React Router lato client)

I fallback SPA escludono i path che terminano con estensione (`.js`, `.css`, immagini, manifest, ecc.): un asset/chunk Vite mancante deve restituire 404, non `index.html`, altrimenti browser con shell vecchie dopo un deploy possono tentare di eseguire HTML come modulo JavaScript.

**Headers `X-Robots-Tag: noindex, nofollow`** su: `/admin`, `/admin/:path*`, `/login`, `/signup`, `/complete-profile`, `/bookings`, `/profile`, `/unsubscribe`, `/newsletter/confirm`, `/Crew/:path*`, `/mcp`, `/api/mcp/:path*`.

**Header di sicurezza su `/(.*)`** (tutte le risposte):

| Header | Valore |
|---|---|
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `SAMEORIGIN` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |

> ⚠️ `SAMEORIGIN` e non `DENY` perché le anteprime admin e i widget embeddati restano su `biteproject.it`. `Permissions-Policy` blocca camera/microfono/geolocalizzazione: se in futuro una feature ne ha bisogno (es. posizione utente sulle mappe, video nelle live BITE Crew), va allargata qui prima, altrimenti il browser nega l'API senza errore evidente.
>
> **Nessuna CSP**, deliberatamente: richiederebbe mappare tutti i domini esterni (Supabase, OpenAI, tile server mappe, OAuth social, LiveKit, Resend) e verificarli in browser. È il pezzo di hardening ancora aperto.

**Rewrites OAuth MCP:** `/.well-known/oauth-authorization-server(/:path*)` → `/api/mcp/oauth/metadata`, `/.well-known/oauth-protected-resource(/:path*)` → `/api/mcp/oauth/protected-resource` → [[25 - MCP Admin]].

## Edge middleware
- `middleware.ts` alla root — routing/prerender a livello edge, in coppia con `apps/web/api/prerender.ts` per servire HTML ai bot → [[03 - Routing e i18n]]. È un file reale (non un symlink), per evitare problemi di packaging Edge su Vercel. Il gemello `apps/web/middleware.ts` **non esiste più**: era una copia mai eseguita, perché Vercel legge solo il middleware di root; teneva due file da sincronizzare a mano senza alcun beneficio → [[04 - Struttura Repository]].
- Il middleware Edge non importa helper da `@vercel/functions`: usa direttamente gli header `x-middleware-next` e `x-middleware-rewrite`, così Vercel non include moduli Node non supportati nell'Edge runtime.
- Gli URL pubblici legacy senza prefisso lingua vengono reindirizzati a `/it/*` o `/en/*` prima del fallback SPA/prerender.
- I sottodomini `pack.biteproject.it` e `data.biteproject.it` vengono riscritti rispettivamente sui prefissi `/pack` e `/Data`.
- `crew.biteproject.it` viene riscritto su `/Crew`, con sub-app dedicata `apps/crew`, stesso backend Supabase e nessun link dalla main app finché la community non è pronta → [[23 - Community]].
- `login.biteproject.it` è l'host dedicato per `/login`, `/signup` e `/complete-profile`; gli stessi path aperti da altri host production vengono reindirizzati lì preservando query string e redirect di ritorno.

## Variabili d'ambiente (`.env`)
Il progetto usa **un solo `.env` root** per lo sviluppo locale. `apps/web` legge lo stesso file via `envDir` in `apps/web/vite.config.ts`; le sotto-app possono mantenere lo stesso pattern se servono variabili condivise. Non mantenere `.env` separati nelle sotto-cartelle.

Prefisso Vite `VITE_` (esposte al client):
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PROJECT_ID`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_LOGIN_URL` opzionale per lo sviluppo delle sub-app: se assente, i bridge locali `/login` puntano a `http://127.0.0.1:5173`.
- `VITE_LIVEKIT_URL` opzionale solo se si vuole mostrare esplicitamente l'URL LiveKit lato client; la room usa comunque `/api/community/livekit-token`.

> ⚠️ I segreti server (Bunq, service role Supabase, chiavi email/VAPID) **non** stanno qui: vanno nelle env di Vercel / secret delle Supabase Functions, mai committati.

Mail admin e invio Resend:
- `RESEND_API_KEY` in Vercel per `/api/email/send` e webhook enrichment.
- `RESEND_WEBHOOK_SECRET` in Vercel per verificare `apps/web/api/webhooks/email/inbound`.
- `RESEND_API_KEY` anche tra i secret Supabase Functions: `process-email-queue` lo usa per spedire auth email, newsletter e transazionali.
- `EMAIL_QUEUE_CRON_SECRET` tra i secret Supabase Functions, con lo stesso valore in Supabase Vault come `email_queue_cron_secret`: autorizza il cron DB `process-email-queue` senza usare la service-role key.
- `AUTH_EMAIL_HOOK_SECRET` tra i secret Supabase Functions se `auth-email-hook` viene chiamata come hook HTTP con bearer condiviso.
- `EMAIL_SUPPRESSION_WEBHOOK_SECRET` tra i secret Supabase Functions solo se `handle-email-suppression` viene esposto a un caller interno non service-role.
- `OPENAI_API_KEY` tra i secret Supabase Functions per i flussi IA editoriali (`translate-editor-content`, `optimize-article-seo`). `TRANSLATION_OPENAI_MODEL` e `SEO_OPENAI_MODEL` sono opzionali; se assenti le function usano `gpt-5.6-luna`. Le vecchie variabili `TRANSLATION_AI_API_KEY` / `TRANSLATION_AI_MODEL` restano accettate solo come fallback di transizione per la traduzione.
- `SUPABASE_SERVICE_ROLE_KEY` e `SUPABASE_ANON_KEY`/`VITE_SUPABASE_PUBLISHABLE_KEY` in Vercel per autenticare admin e scrivere lo storico mail.
- `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY`, `WEB_PUSH_VAPID_SUBJECT` in Vercel per notificare gli admin quando arrivano nuove mail.
- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` in Vercel per generare token delle room BITE Crew.
- `MCP_TOKEN_PEPPER` in Vercel (≥32 caratteri, generato a caso): è il pepper dell'HMAC con cui `/api/mcp` hasha i token del server MCP admin → [[25 - MCP Admin]]. Senza, l'endpoint rifiuta ogni richiesta invece di accettare hash riproducibili.
- Le Supabase Edge Functions automatiche usano `mail.biteproject.it` come sender domain.

Secret Supabase Functions / Vault specifici community:
- `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY`, `WEB_PUSH_VAPID_SUBJECT` devono essere presenti anche tra i secret Supabase Functions: `dispatch-community-live-notifications` li usa per le push dei live BITE Crew.
- `EMAIL_QUEUE_CRON_SECRET` tra i secret Supabase Functions deve combaciare con `email_queue_cron_secret` in Supabase Vault: `public.invoke_email_queue_worker()` lo usa per chiamare sia `process-email-queue` sia `dispatch-community-live-notifications`.
- `LIVEKIT_*` resta su Vercel, non su Supabase Functions, perche i token vengono generati da `/api/community/livekit-token`.

OAuth social del calendario editoriale (secret Supabase Functions, non Vercel):
- `SOCIAL_OAUTH_STATE_SECRET` — segreto HMAC per firmare lo state OAuth.
- `SOCIAL_OAUTH_CALLBACK_URL` — `https://ekwloweuicrqjjgabfdp.supabase.co/functions/v1/social-oauth-callback`, da registrare anche nei portali provider.
- `SOCIAL_OAUTH_FRONTEND_URL` — `https://admin.biteproject.it/admin`, destinazione dopo successo/errore sul sottodominio admin.
- `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET` — app creata nel portale Meta, sezione Instagram > API setup with Instagram login; richiesta per i canali Instagram del piano editoriale.
- `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` — da configurare solo quando si abilita il collegamento OAuth dei relativi canali.

Template locale: `.env.example`. Variabile server rilevante per pagamenti: `BUNQ_WEBHOOK_SECRET`, da configurare in Vercel e nella callback Bunq.

## Build
- `npm run build` orchestra: `build:web` (sitemap + Vite build in `apps/web`) → `build:pack` (`/pack/`) → `build:data` (`/Data/`) → `build:crew` (`/Crew/`) → `copy-subapp-builds.mjs`.
- Base path sotto-app via `VITE_BASE_PATH`. Vedi [[19 - Sub-App (pack e data)]] e [[20 - Comandi e Workflow]].
- `scripts/copy-subapp-builds.mjs` ricrea `dist/`, copia `apps/web/dist` alla root della build e copia `apps/pack/dist` in `dist/pack`, `apps/data/dist` in `dist/Data`, `apps/crew/dist` in `dist/Crew`.
- `apps/web/scripts/generate-sitemap.mjs` legge sia `apps/web/.env` sia `.env` root, così la build monorepo locale genera anche URL dinamici di articoli/viaggi e non solo le rotte statiche. Poiché legge dati live, **ogni build locale riscrive `apps/web/public/sitemap.xml`** e `git status` lo mostra modificato: è rumore, non una modifica reale. `git checkout -- apps/web/public/sitemap.xml` prima di leggere lo stato del working tree.
- ⚠️ **`npm run build` non fa type-check.** Lo script è `seo:sitemap && vite build`, e Vite transpila senza controllare i tipi: una build verde non dice nulla sui type error → [[20 - Comandi e Workflow]].
- Chunking Vite: app principale e sub-app separano vendor pesanti (`router`, `query`, `radix`, `icons`, `maps`, `three`/`tiptap` dove presenti). `apps/pack` carica la pagina principale in lazy route; `apps/data` isola MapLibre nel chunk `maps`, così la route `/map` resta leggera e il vendor viene scaricato/cacheato separatamente.

## Note ambiente
- Repo git: `github.com/MPernozzoli/BITEProject.it` (branch `main`), **pubblico**. Ogni push su `main` viene auto-deployato in produzione da Vercel: non esiste staging né review gate. Trattare ogni commit come una release.
- **Versione Node:** `.nvmrc` (`24`) e `engines.node` (`24.x`) in `package.json` root fissano la major allineata al runtime Vercel. ⚠️ La macchina di sviluppo gira **Node 25.2.1**, fuori da quel vincolo, e questo **rompe `eslint` e `vitest`** → [[20 - Comandi e Workflow]]. In Homebrew esiste un solo Node reale: `/opt/homebrew/opt/node@23` e `node@25` sono symlink fantasma allo stesso `Cellar/node` 25.2.1. Per affiancare la 24 usare `nvm`/`fnm`, **non** Homebrew: installare un secondo Node da Homebrew ha già rotto una volta il `node` di default per conflitto ABI su `simdjson` (`dyld: Library not loaded: libsimdjson.29.dylib`).
- Package manager: usare npm come fonte di lock principale (`package-lock.json`).
- I vecchi lock Bun sono stati rimossi: erano residui del setup iniziale e non devono essere rigenerati.
- `.obsidian/` **non** è in `.gitignore`: valuta se ignorare il vault o versionarlo.
- Supabase Cron è usato per manutenzioni DB (`deactivate-past-voyage-bookable-legs`, `expire-pending-voyage-booking-payments`) → [[08 - Supabase]].
- Hardening residuo da dashboard: abilitare **leaked password protection** in Supabase Auth. `homepage-media` è listabile pubblicamente solo sui prefissi hero usati dalla home.
- Supabase Auth: registrare `login.biteproject.it` e gli URL di ritorno BITE tra gli allowed redirect URLs, usando URL production espliciti dove possibile.
- Community launch checklist: prima di linkare `crew.biteproject.it` dalla main app, verificare DNS, redirect auth, LiveKit env Vercel, VAPID secret Supabase Functions, iscrizione push per utenti non-admin e rimozione eventuale di `X-Robots-Tag: noindex,nofollow` su `/Crew/:path*`.

## Collegamenti
- [[10 - API Vercel]] · [[19 - Sub-App (pack e data)]] · [[20 - Comandi e Workflow]] · [[23 - Community]]
