---
tags: [monorepo, apps, sub-app]
---
# 19 - Sub-App (pack e data)

⬅️ [[Home]] · sorgente: `apps/` · build: `scripts/copy-subapp-builds.mjs`

Il repo è un **monorepo leggero**: la web app principale (`src/`) più sotto-app indipendenti in `apps/`, ognuna con il proprio Vite/Tailwind/tsconfig e pacchetto namespaced.

| Cartella | Pacchetto | Build base path | Ruolo |
|---|---|---|---|
| `apps/web` | `@biteproject/web` | — | variante/mirror della web app |
| `apps/pack` | `@biteproject/pack` | `/_pack/` | superficie applicativa "pack" |
| `apps/data` | `@biteproject/data` | `/_data/` | superficie del [[15 - Semantic Layer (AI Agents)]] (dati/GeoJSON) |

## Build integrata
In `package.json` root:
```
build:pack  = VITE_BASE_PATH=/_pack/ npm run build --prefix apps/pack
build:data  = VITE_BASE_PATH=/_data/ npm run build --prefix apps/data
```
Poi `scripts/copy-subapp-builds.mjs` copia i `dist/` delle sotto-app nella build principale, così vengono servite come sotto-percorsi dello stesso dominio (coerente con la strategia same-origin → [[15 - Semantic Layer (AI Agents)]]).

## Note
- Ogni sotto-app ha una propria cartella `supabase/` e config di test (Playwright/Vitest).
- Esistono duplicati ` 2` (`apps/web 2`, `apps/pack 2`, `apps/data 2`): artefatti di copia, non attivi → vedi [[04 - Struttura Repository]].

## Collegamenti
- [[18 - Deploy e Configurazione]] · [[20 - Comandi e Workflow]] · [[15 - Semantic Layer (AI Agents)]]
