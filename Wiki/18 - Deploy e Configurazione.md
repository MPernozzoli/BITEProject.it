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
Prefisso Vite `VITE_` (esposte al client):
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PROJECT_ID`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

> ⚠️ I segreti server (Bunq, service role Supabase, chiavi email/VAPID) **non** stanno qui: vanno nelle env di Vercel / secret delle Supabase Functions, mai committati.

## Build
- `npm run build` orchestra: `build:web` (sitemap + Vite build) → `build:pack` (`/_pack/`) → `build:data` (`/_data/`) → `copy-subapp-builds.mjs`.
- Base path sotto-app via `VITE_BASE_PATH`. Vedi [[19 - Sub-App (pack e data)]] e [[20 - Comandi e Workflow]].

## Note ambiente
- Repo git: `github.com/MPernozzoli/BITEProject.it` (branch `main`).
- Package manager: sono presenti sia `package-lock.json` (npm) sia `bun.lock`/`bun.lockb` (bun).
- `.obsidian/` **non** è in `.gitignore`: valuta se ignorare il vault o versionarlo.

## Collegamenti
- [[10 - API Vercel]] · [[19 - Sub-App (pack e data)]] · [[20 - Comandi e Workflow]]
