---
tags: [deploy, vercel, config, env]
---
# 18 - Deploy e Configurazione

⬅️ [[Home]] · sorgente: `vercel.json`, `apps/web/middleware.ts`, `.env`, `apps/web/vite.config.ts`

## Hosting
- **Vercel** (cartella `.vercel/`). Frontend SPA da `apps/web` + Vercel Functions (`api` symlink a `apps/web/api`) → [[10 - API Vercel]].
- Backend dati/logica su [[08 - Supabase]].

## `vercel.json`
**Rewrites:**
- `/llms.txt` → `/api/llms`
- `/llms-full.txt` → `/api/llms?full=1`
- `/sitemap-live.xml` → `/api/sitemap`
- `/pack/:path*` → `/pack/index.html`
- `/Data/:path*` → `/Data/index.html`
- `/(.*)` → `/` (SPA fallback, React Router lato client)

**Headers `X-Robots-Tag: noindex, nofollow`** su: `/admin`, `/admin/:path*`, `/login`, `/signup`, `/bookings`, `/profile`, `/unsubscribe`, `/newsletter/confirm`.

## Edge middleware
- `middleware.ts` alla root — routing/prerender a livello edge, in coppia con `apps/web/api/prerender.ts` per servire HTML ai bot → [[03 - Routing e i18n]]. Mantiene lo stesso contenuto operativo di `apps/web/middleware.ts`, ma resta un file reale per evitare problemi di packaging Edge su Vercel.
- Il middleware Edge non importa helper da `@vercel/functions`: usa direttamente gli header `x-middleware-next` e `x-middleware-rewrite`, così Vercel non include moduli Node non supportati nell'Edge runtime.
- Gli URL pubblici legacy senza prefisso lingua vengono reindirizzati a `/it/*` o `/en/*` prima del fallback SPA/prerender.
- I sottodomini `pack.biteproject.it` e `data.biteproject.it` vengono riscritti rispettivamente sui prefissi `/pack` e `/Data`.

## Variabili d'ambiente (`.env`)
Il progetto usa **un solo `.env` root** per lo sviluppo locale. `apps/web` legge lo stesso file via `envDir` in `apps/web/vite.config.ts`; le sotto-app possono mantenere lo stesso pattern se servono variabili condivise. Non mantenere `.env` separati nelle sotto-cartelle.

Prefisso Vite `VITE_` (esposte al client):
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PROJECT_ID`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

> ⚠️ I segreti server (Bunq, service role Supabase, chiavi email/VAPID) **non** stanno qui: vanno nelle env di Vercel / secret delle Supabase Functions, mai committati.

Mail admin e invio Resend:
- `RESEND_API_KEY` in Vercel per `/api/email/send` e webhook enrichment.
- `RESEND_WEBHOOK_SECRET` in Vercel per verificare `apps/web/api/webhooks/email/inbound`.
- `RESEND_API_KEY` anche tra i secret Supabase Functions: `process-email-queue` lo usa per spedire auth email, newsletter e transazionali.
- `AUTH_EMAIL_HOOK_SECRET` tra i secret Supabase Functions se `auth-email-hook` viene chiamata come hook HTTP con bearer condiviso.
- `EMAIL_SUPPRESSION_WEBHOOK_SECRET` tra i secret Supabase Functions solo se `handle-email-suppression` viene esposto a un caller interno non service-role.
- `OPENAI_API_KEY` tra i secret Supabase Functions per i flussi IA editoriali (`translate-editor-content`, `optimize-article-seo`). `TRANSLATION_OPENAI_MODEL` e `SEO_OPENAI_MODEL` sono opzionali; se assenti le function usano `gpt-5.6-luna`. Le vecchie variabili `TRANSLATION_AI_API_KEY` / `TRANSLATION_AI_MODEL` restano accettate solo come fallback di transizione per la traduzione.
- `SUPABASE_SERVICE_ROLE_KEY` e `SUPABASE_ANON_KEY`/`VITE_SUPABASE_PUBLISHABLE_KEY` in Vercel per autenticare admin e scrivere lo storico mail.
- `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY`, `WEB_PUSH_VAPID_SUBJECT` in Vercel per notificare gli admin quando arrivano nuove mail.
- Le Supabase Edge Functions automatiche usano `mail.biteproject.it` come sender domain.

OAuth social del calendario editoriale (secret Supabase Functions, non Vercel):
- `SOCIAL_OAUTH_STATE_SECRET` — segreto HMAC per firmare lo state OAuth.
- `SOCIAL_OAUTH_CALLBACK_URL` — `https://ekwloweuicrqjjgabfdp.supabase.co/functions/v1/social-oauth-callback`, da registrare anche nei portali provider.
- `SOCIAL_OAUTH_FRONTEND_URL` — `https://admin.biteproject.it/admin`, destinazione dopo successo/errore sul sottodominio admin.
- `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET` — app creata nel portale Meta, sezione Instagram > API setup with Instagram login; richiesta per i canali Instagram del piano editoriale.
- `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` — da configurare solo quando si abilita il collegamento OAuth dei relativi canali.

Template locale: `.env.example`. Variabile server rilevante per pagamenti: `BUNQ_WEBHOOK_SECRET`, da configurare in Vercel e nella callback Bunq.

## Build
- `npm run build` orchestra: `build:web` (sitemap + Vite build in `apps/web`) → `build:pack` (`/pack/`) → `build:data` (`/Data/`) → `copy-subapp-builds.mjs`.
- Base path sotto-app via `VITE_BASE_PATH`. Vedi [[19 - Sub-App (pack e data)]] e [[20 - Comandi e Workflow]].
- `scripts/copy-subapp-builds.mjs` ricrea `dist/`, copia `apps/web/dist` alla root della build e copia `apps/pack/dist` in `dist/pack`, `apps/data/dist` in `dist/Data`.
- `apps/web/scripts/generate-sitemap.mjs` legge sia `apps/web/.env` sia `.env` root, così la build monorepo locale genera anche URL dinamici di articoli/viaggi e non solo le rotte statiche.
- Chunking Vite: app principale e sub-app separano vendor pesanti (`router`, `query`, `radix`, `icons`, `maps`, `three`/`tiptap` dove presenti). `apps/pack` carica la pagina principale in lazy route; `apps/data` isola MapLibre nel chunk `maps`, così la route `/map` resta leggera e il vendor viene scaricato/cacheato separatamente.

## Note ambiente
- Repo git: `github.com/MPernozzoli/BITEProject.it` (branch `main`).
- Package manager: usare npm come fonte di lock principale (`package-lock.json`).
- I vecchi lock Bun sono stati rimossi: erano residui del setup iniziale e non devono essere rigenerati.
- `.obsidian/` **non** è in `.gitignore`: valuta se ignorare il vault o versionarlo.
- Supabase Cron è usato per manutenzioni DB (`deactivate-past-voyage-bookable-legs`, `expire-pending-voyage-booking-payments`) → [[08 - Supabase]].
- Hardening residuo da dashboard: abilitare **leaked password protection** in Supabase Auth. `homepage-media` è listabile pubblicamente solo sui prefissi hero usati dalla home.

## Collegamenti
- [[10 - API Vercel]] · [[19 - Sub-App (pack e data)]] · [[20 - Comandi e Workflow]]
