---
tags: [struttura, filesystem, monorepo]
---
# 04 - Struttura Repository

⬅️ [[Home]]

## Albero di primo livello

```
iubgicrwfovrnvoqr/
├── apps/              # applicazioni Vite → [[19 - Sub-App (pack e data)]]
│   ├── web/           # @biteproject/web, sito principale
│   │   ├── src/       # React app → [[05 - Frontend - Pagine]] / [[06 - Frontend - Componenti]]
│   │   ├── api/       # Vercel Functions sorgente → [[10 - API Vercel]]
│   │   │               #   api/mcp/ = server MCP admin → [[25 - MCP Admin]]
│   │   │               #   (logica in src/server/mcp/)
│   │   ├── public/    # asset statici del sito principale
│   │   ├── scripts/   # generate-sitemap
│   │   └── supabase/  # backend Supabase sorgente → [[08 - Supabase]]
│   ├── pack/          # @biteproject/pack, sito cani servito in /pack
│   ├── data/          # @biteproject/data, app dati servita in /Data
│   └── crew/          # @biteproject/crew, community BITE Crew servita in /Crew
├── api -> apps/web/api
│                       # symlink per compatibilità Vercel root
├── supabase -> apps/web/supabase
│                       # symlink per compatibilità Supabase CLI
├── shared/            # codice condiviso dalle 4 app, fuori da apps/
│   └── supabase/      #   auth-storage.ts (storage sessione cross-sottodominio)
│                       #   create-client.ts (factory del client browser)
│                       #   → alias "@shared" → [[19 - Sub-App (pack e data)]]
├── docs/              # documentazione sorgente
│   ├── bite-atlas-architecture.md  → [[15 - Semantic Layer (AI Agents)]]
│   ├── payments-bunq.md            → [[11 - Pagamenti Bunq]]
│   └── migration/     # schema storico/consolidato
├── scripts/           # copy-subapp-builds (composizione dist root)
├── dist/              # output build root generato: web + /pack + /Data + /Crew
├── middleware.ts      # edge middleware (prerender/routing) — file reale, unico,
│                       #   letto da Vercel solo alla root → [[18 - Deploy e Configurazione]]
├── backups/           # export/backup locali, in .gitignore: mai committare
├── vercel.json        # rewrite + header → [[18 - Deploy e Configurazione]]
└── package.json       # workspace + script root → [[20 - Comandi e Workflow]]
```

> Nota: la root non contiene più una copia applicativa `src/`, `public/` o `supabase/`. La sorgente attiva del sito principale vive in `apps/web`; `api` e `supabase` alla root sono solo symlink di compatibilità.
>
> `middleware.ts` invece **non** è un symlink ed esiste solo alla root: il duplicato `apps/web/middleware.ts` era dead code (Vercel legge esclusivamente quello di root) ed è stato rimosso. Non ricrearlo.

## Alias di import
Ogni app definisce **due** alias, in coppia nel suo `vite.config.ts` (per il bundler) e nel suo `tsconfig.app.json` (per il type-check). Se se ne aggiunge uno, vanno aggiornati entrambi i file in tutte e quattro le app, altrimenti `tsc` e la build divergono:

| Alias | Punta a |
|---|---|
| `@` | `apps/<app>/src` |
| `@shared` | `shared/` alla root del repo |

`shared/` non è un workspace npm: è una cartella di sorgenti TypeScript risolta per alias. Non richiede `npm install` né una entry in `workspaces`, e Vite la transpila come codice di progetto perché sta fuori da `node_modules`.

## File di configurazione chiave
- `.nvmrc` (`24`) + `engines.node` (`24.x`) in `package.json` root — allineano la versione Node locale a quella del runtime Vercel
- `apps/web/components.json` — config shadcn/ui del sito principale
- `apps/web/eslint.config.js` — lint flat config
- `apps/web/vitest.config.ts` / `apps/web/playwright.config.ts` — test web
- `apps/web/postcss.config.js` — PostCSS/Tailwind
- `.env` — variabili Vite (vedi [[18 - Deploy e Configurazione]])

## Collegamenti
- [[01 - Architettura]] · [[02 - Stack Tecnologico]] · [[23 - Community]]
