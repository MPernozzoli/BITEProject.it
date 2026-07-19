---
tags: [comandi, workflow, script, dx]
---
# 20 - Comandi e Workflow

⬅️ [[Home]] · sorgente: `package.json` (scripts)

## Script npm (root)
| Comando | Azione |
|---|---|
| `npm run dev` | dev server Vite di `@biteproject/web` (`apps/web`) |
| `npm run build` | build completa: web + pack + data + crew + copia dist sotto-app |
| `npm run build:web` | genera sitemap + `vite build` in `apps/web` |
| `npm run build:pack` | build `apps/pack` con base `/pack/` → [[19 - Sub-App (pack e data)]] |
| `npm run build:data` | build `apps/data` con base `/Data/` |
| `npm run build:crew` | build `apps/crew` con base `/Crew/` → [[23 - Community]] |
| `npm run build:dev` | build development di `@biteproject/web` |
| `npm run preview` | preview di `@biteproject/web` |
| `npm run lint` | ESLint di `@biteproject/web` |
| `npm run test` | Vitest di `@biteproject/web` (run singolo) |
| `npm run test:watch` | Vitest di `@biteproject/web` in watch |
| `npm run --workspace @biteproject/web seo:sitemap` | genera sitemap (`apps/web/scripts/generate-sitemap.mjs`) |

## Testing
- **Unit/component:** Vitest + Testing Library → `apps/web/src/test/`, config `apps/web/vitest.config.ts`.
- **E2E:** Playwright → `apps/web/playwright.config.ts`, `apps/web/playwright-fixture.ts`.
- **Lint:** ESLint segnala gli `any` come warning progressivi; gli errori bloccanti restano riservati a bug probabili (es. Rules of Hooks, import non supportati, direttive TS unsafe).
- **Bundle check:** `npm run build` mostra la distribuzione dei chunk Vite. I vendor pesanti sono separati in chunk cacheabili; i warning su dimensioni grezze vanno valutati guardando anche il peso gzip e se il chunk è lazy.

## Supabase (CLI, se usata)
- Config progetto in `apps/web/supabase/config.toml` (project `ekwloweuicrqjjgabfdp`); `supabase` root è un symlink.
- Migrazioni in `apps/web/supabase/migrations/` → [[08 - Supabase]].
- Edge Functions in `apps/web/supabase/functions/` (Deno) → [[09 - Edge Functions]].

## Workflow tipici
- **Sviluppo UI:** `npm run dev` → modifica in `apps/web/src/` → [[05 - Frontend - Pagine]] / [[06 - Frontend - Componenti]].
- **Nuovo endpoint dati pubblico:** aggiungi/modifica function `public-*` → [[15 - Semantic Layer (AI Agents)]].
- **Modifica schema:** nuova migrazione SQL + rigenera `apps/web/src/integrations/supabase/types.ts`.
- **Community:** `npm run build:crew` per la sola sub-app; `npm run build` copia poi `apps/crew/dist` in `dist/Crew`.
- **Deploy:** push su `main` → Vercel build (`npm run build`) → [[18 - Deploy e Configurazione]].

## Workflow agenti AI
- Gli agenti devono indicare esplicitamente ogni passaggio che richiede un'azione umana, distinguendolo dalle attività completate in autonomia.
- Prima di chiedere interventi manuali, gli agenti devono predisporre quanto più possibile: generare valori configurabili localmente quando opportuno, preparare file/comandi e indicare con precisione dove inserire chiavi, token o segreti.
- Quando un'implementazione introduce o modifica migrazioni Supabase, gli agenti devono applicarle autonomamente al termine del lavoro e verificarne l'esito. Se credenziali o accessi mancanti lo impediscono, devono lasciare istruzioni operative complete e segnalare il blocco come azione richiesta all'umano.

## Note package manager
Usare npm come package manager operativo del progetto. `package-lock.json` è il lockfile da aggiornare quando si interviene sulle dipendenze.
Per `@pynkstudio/mailapp` usare il tarball GitHub pubblico già presente in `package.json`; l'install richiede `--legacy-peer-deps` finché il package dichiara peer React 19 e questa app resta su React 18.

## Collegamenti
- [[18 - Deploy e Configurazione]] · [[19 - Sub-App (pack e data)]] · [[08 - Supabase]] · [[23 - Community]]
