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
├── middleware.ts -> apps/web/middleware.ts
│                       # symlink per compatibilità Vercel root
├── supabase -> apps/web/supabase
│                       # symlink per compatibilità Supabase CLI
├── docs/              # documentazione sorgente
│   ├── bite-atlas-architecture.md  → [[15 - Semantic Layer (AI Agents)]]
│   ├── payments-bunq.md            → [[11 - Pagamenti Bunq]]
│   └── migration/     # schema storico/consolidato
├── scripts/           # copy-subapp-builds (composizione dist root)
├── dist/              # output build root generato: web + /pack + /Data + /Crew
├── middleware.ts      # edge middleware (prerender/routing)
├── vercel.json        # rewrite + header → [[18 - Deploy e Configurazione]]
└── package.json       # workspace + script root → [[20 - Comandi e Workflow]]
```

> Nota: la root non contiene più una copia applicativa `src/`, `public/` o `supabase/`. La sorgente attiva del sito principale vive in `apps/web`; `api`, `middleware.ts` e `supabase` alla root sono solo symlink di compatibilità.

## File di configurazione chiave
- `apps/web/components.json` — config shadcn/ui del sito principale
- `apps/web/eslint.config.js` — lint flat config
- `apps/web/vitest.config.ts` / `apps/web/playwright.config.ts` — test web
- `apps/web/postcss.config.js` — PostCSS/Tailwind
- `.env` — variabili Vite (vedi [[18 - Deploy e Configurazione]])

## Collegamenti
- [[01 - Architettura]] · [[02 - Stack Tecnologico]] · [[23 - Community]]
