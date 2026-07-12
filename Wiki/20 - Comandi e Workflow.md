---
tags: [comandi, workflow, script, dx]
---
# 20 - Comandi e Workflow

⬅️ [[Home]] · sorgente: `package.json` (scripts)

## Script npm (root)
| Comando | Azione |
|---|---|
| `npm run dev` | dev server Vite (app principale) |
| `npm run build` | build completa: web + pack + data + copia dist sotto-app |
| `npm run build:web` | genera sitemap + `vite build` |
| `npm run build:pack` | build `apps/pack` con base `/_pack/` → [[19 - Sub-App (pack e data)]] |
| `npm run build:data` | build `apps/data` con base `/_data/` |
| `npm run build:dev` | build in mode development |
| `npm run preview` | preview della build |
| `npm run lint` | ESLint su tutto |
| `npm run test` | Vitest (run singolo) |
| `npm run test:watch` | Vitest in watch |
| `npm run seo:sitemap` | genera sitemap (`scripts/generate-sitemap.mjs`) |

## Testing
- **Unit/component:** Vitest + Testing Library → `src/test/`, config `vitest.config.ts`.
- **E2E:** Playwright → `playwright.config.ts`, `playwright-fixture.ts`.
- **Lint:** ESLint segnala gli `any` come warning progressivi; gli errori bloccanti restano riservati a bug probabili (es. Rules of Hooks, import non supportati, direttive TS unsafe).
- **Bundle check:** `npm run build` mostra la distribuzione dei chunk Vite. I vendor pesanti sono separati in chunk cacheabili; i warning su dimensioni grezze vanno valutati guardando anche il peso gzip e se il chunk è lazy.

## Supabase (CLI, se usata)
- Config progetto in `supabase/config.toml` (project `ekwloweuicrqjjgabfdp`).
- Migrazioni in `supabase/migrations/` (36 file) → [[08 - Supabase]].
- Edge Functions in `supabase/functions/` (Deno) → [[09 - Edge Functions]].

## Workflow tipici
- **Sviluppo UI:** `npm run dev` → modifica in `src/` → [[05 - Frontend - Pagine]] / [[06 - Frontend - Componenti]].
- **Nuovo endpoint dati pubblico:** aggiungi/modifica function `public-*` → [[15 - Semantic Layer (AI Agents)]].
- **Modifica schema:** nuova migrazione SQL + rigenera `src/integrations/supabase/types.ts`.
- **Deploy:** push su `main` → Vercel build (`npm run build`) → [[18 - Deploy e Configurazione]].

## Note package manager
Usare npm come package manager operativo del progetto. `package-lock.json` è il lockfile da aggiornare quando si interviene sulle dipendenze.

## Collegamenti
- [[18 - Deploy e Configurazione]] · [[19 - Sub-App (pack e data)]] · [[08 - Supabase]]
