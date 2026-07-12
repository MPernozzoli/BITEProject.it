---
tags: [deploy, vercel, config, env]
---
# 18 - Deploy e Configurazione

⬅️ [[Home]] · sorgente: `vercel.json`, `middleware.ts`, `.env`, `vite.config.ts`

## Hosting
- **Vercel** (cartella `.vercel/`). Frontend SPA + Vercel Functions (`api/`) → [[10 - API Vercel]].
- Backend dati/logica su [[08 - Supabase]].

## `vercel.json`
**Rewrites:**
- `/sitemap-live.xml` → `/api/sitemap`
- `/(.*)` → `/` (SPA fallback, React Router lato client)

**Headers `X-Robots-Tag: noindex, nofollow`** su: `/admin`, `/admin/:path*`, `/login`, `/signup`, `/bookings`, `/profile`, `/unsubscribe`, `/newsletter/confirm`.

## Edge middleware
- `middleware.ts` — routing/prerender a livello edge, in coppia con `api/prerender.ts` per servire HTML ai bot → [[03 - Routing e i18n]].

## Variabili d'ambiente (`.env`)
Il progetto usa **un solo `.env` root** per lo sviluppo locale. Le sotto-app `apps/web`, `apps/pack` e `apps/data` leggono lo stesso file via `envDir` nei rispettivi `vite.config.ts`; non mantenere `.env` separati nelle sotto-cartelle.

Prefisso Vite `VITE_` (esposte al client):
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PROJECT_ID`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

> ⚠️ I segreti server (Bunq, service role Supabase, chiavi email/VAPID) **non** stanno qui: vanno nelle env di Vercel / secret delle Supabase Functions, mai committati.

Template locale: `.env.example`. Variabile server rilevante per pagamenti: `BUNQ_WEBHOOK_SECRET`, da configurare in Vercel e nella callback Bunq.

## Build
- `npm run build` orchestra: `build:web` (sitemap + Vite build) → `build:pack` (`/_pack/`) → `build:data` (`/_data/`) → `copy-subapp-builds.mjs`.
- Base path sotto-app via `VITE_BASE_PATH`. Vedi [[19 - Sub-App (pack e data)]] e [[20 - Comandi e Workflow]].
- Chunking Vite: app principale e sub-app separano vendor pesanti (`router`, `query`, `radix`, `icons`, `maps`, `three`/`tiptap` dove presenti). `apps/pack` carica la pagina principale in lazy route; `apps/data` isola MapLibre nel chunk `maps`, così la route `/map` resta leggera e il vendor viene scaricato/cacheato separatamente.

## Note ambiente
- Repo git: `github.com/MPernozzoli/BITEProject.it` (branch `main`).
- Package manager: usare npm come fonte di lock principale (`package-lock.json`).
- `.obsidian/` **non** è in `.gitignore`: valuta se ignorare il vault o versionarlo.
- Supabase Cron è usato per manutenzioni DB (`deactivate-past-voyage-bookable-legs`, `expire-pending-voyage-booking-payments`) → [[08 - Supabase]].
- Hardening residuo da dashboard: abilitare **leaked password protection** in Supabase Auth. `homepage-media` è listabile pubblicamente solo sui prefissi hero usati dalla home.

## Collegamenti
- [[10 - API Vercel]] · [[19 - Sub-App (pack e data)]] · [[20 - Comandi e Workflow]]
