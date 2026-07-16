---
tags: [monorepo, apps, sub-app]
---
# 19 - Sub-App (pack e data)

⬅️ [[Home]] · sorgente: `apps/` · build: `scripts/copy-subapp-builds.mjs`

Il repo è un **monorepo leggero**: tutte le app Vite vivono in `apps/`, ognuna con il proprio Vite/Tailwind/tsconfig e pacchetto namespaced. La root contiene solo orchestrazione, deploy, documentazione e symlink di compatibilità.

| Cartella | Pacchetto | Build base path | Ruolo |
|---|---|---|---|
| `apps/web` | `@biteproject/web` | `/` | sito principale BITE |
| `apps/pack` | `@biteproject/pack` | `/pack/` | sito dei cani / pack |
| `apps/data` | `@biteproject/data` | `/Data/` | portale **citizen science** su `data.biteproject.it` → [[22 - Citizen Science e Osservazioni]]; superficie del [[15 - Semantic Layer (AI Agents)]] (dati/GeoJSON) |

## Build integrata
In `package.json` root:
```
build:web   = npm run build --workspace @biteproject/web
build:pack  = VITE_BASE_PATH=/pack/ npm run build --workspace @biteproject/pack
build:data  = VITE_BASE_PATH=/Data/ npm run build --workspace @biteproject/data
```
Poi `scripts/copy-subapp-builds.mjs` ricrea `dist/`, copia `apps/web/dist` alla root della build, `apps/pack/dist` in `dist/pack` e `apps/data/dist` in `dist/Data`, così le app vengono servite come sotto-percorsi dello stesso dominio (coerente con la strategia same-origin → [[15 - Semantic Layer (AI Agents)]]).

## Design system condiviso (`apps/data`)
`apps/data` **non** ha un proprio tema: usa quello di `apps/web`, così i due non possono divergere (prima divergevano già — palette fredda contro quella calda del sito, `--radius` e teal diversi).

- `apps/data/src/index.css` fa `@import "../../web/src/index.css"` e sotto aggiunge **solo** ciò che è davvero suo: la palette di stato data-viz (`--data-blue/green/amber/red`) e le classi `.data-badge` / `.metric-*`.
- `apps/data/postcss.config.js` deve avere **`postcss-import` prima di `tailwindcss`**: Tailwind ha bisogno che le direttive `@tailwind` del file importato siano inline in un unico file, altrimenti fallisce con «`@layer components` is used but no matching `@tailwind components` directive is present».
- `apps/data/tailwind.config.ts` importa `../web/tailwind.config` e ne fa lo spread: sono suoi solo `content` e i colori data-viz.
- `DataLayout.tsx` replica lo shell di `web/src/components/Layout.tsx` (`.site-shell` + tre `.site-shell__orb`): senza le orbite ambientali il portale sembra un altro prodotto sulla stessa palette.
- `DataNavbar.tsx` usa la stessa chrome del `Navbar.tsx` del sito: `nav-shell-light` + `nav-chip-light` + `text-slate-900`, guscio **sempre chiaro** (`rounded-[30px]`, `h-16 md:h-[4.75rem]`, `md:px-7`). Prima alternava `glass-panel-dark`/`glass-panel` in base allo scroll, che il sito principale non fa: quella logica è stata rimossa. L'unico scostamento è il gap fra i link (`gap-1.5` invece di `gap-7`), perché questo nav ne ha otto contro quattro.
- Tailwind fa tree-shaking delle classi in `@layer components` che il portale non usa (hero, admin, marker di presenza), quindi il CSS di data resta ~76 kB / 14,5 kB gzip contro i ~167 kB / 28 kB del sito. Le classi `.voyage-popup` fanno eccezione perché in `web/src/index.css` stanno **fuori** da `@layer` e non vengono eliminate: sono qualche kB di peso morto, innocuo perché tutte scopate sotto `.voyage-waypoint-popup`.
- Se aggiungi un token al sito principale arriva gratis su data. Se aggiungi un'utility Tailwind custom usata dal CSS di `web`, va aggiunta al config condiviso o il build di data si rompe su `@apply`.
- `pack` ha ancora il proprio tema: non è stato toccato.

## Note
- `apps/web/supabase` è la sorgente Supabase attiva; `supabase` alla root è un symlink per CLI/workflow esistenti.
- `api` alla root è un symlink verso `apps/web/api`, così Vercel continua a vedere `/api/*` senza mantenere una seconda copia.
- Le migrazioni delle sub-app vivono comunque in `apps/web/supabase/migrations/`: il progetto Supabase è uno solo.
- Dev server delle sub-app in `.claude/launch.json`: `pack` → 5199, `data` → 5197.
- Stato di `apps/data`: la mappa (`/map`) legge dati reali; `Data Explorer`, `Sensors`, `Missions` e `Downloads` sono ancora **mock hardcoded** nei rispettivi file.

## Collegamenti
- [[18 - Deploy e Configurazione]] · [[20 - Comandi e Workflow]] · [[15 - Semantic Layer (AI Agents)]] · [[22 - Citizen Science e Osservazioni]]
