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
| `apps/data` | `@biteproject/data` | `/Data/` | superficie del [[15 - Semantic Layer (AI Agents)]] (dati/GeoJSON) |

## Build integrata
In `package.json` root:
```
build:web   = npm run build --workspace @biteproject/web
build:pack  = VITE_BASE_PATH=/pack/ npm run build --workspace @biteproject/pack
build:data  = VITE_BASE_PATH=/Data/ npm run build --workspace @biteproject/data
```
Poi `scripts/copy-subapp-builds.mjs` ricrea `dist/`, copia `apps/web/dist` alla root della build, `apps/pack/dist` in `dist/pack` e `apps/data/dist` in `dist/Data`, così le app vengono servite come sotto-percorsi dello stesso dominio (coerente con la strategia same-origin → [[15 - Semantic Layer (AI Agents)]]).

## Note
- `apps/web/supabase` è la sorgente Supabase attiva; `supabase` alla root è un symlink per CLI/workflow esistenti.
- `api` alla root è un symlink verso `apps/web/api`, così Vercel continua a vedere `/api/*` senza mantenere una seconda copia.

## Collegamenti
- [[18 - Deploy e Configurazione]] · [[20 - Comandi e Workflow]] · [[15 - Semantic Layer (AI Agents)]]
