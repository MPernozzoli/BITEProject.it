---
tags: [struttura, filesystem, monorepo]
---
# 04 - Struttura Repository

⬅️ [[Home]]

## Albero di primo livello

```
iubgicrwfovrnvoqr/
├── src/               # app web principale (React) → [[05..07]]
│   ├── App.tsx        # routing radice → [[03 - Routing e i18n]]
│   ├── main.tsx       # bootstrap (+ boot splash 3D, PWA)
│   ├── pages/         # 28 pagine → [[05 - Frontend - Pagine]]
│   ├── components/    # componenti → [[06 - Frontend - Componenti]]
│   ├── lib/           # logica condivisa → [[07 - Frontend - Lib e Hooks]]
│   ├── hooks/         # hook React → [[07 - Frontend - Lib e Hooks]]
│   ├── integrations/  # client Supabase + Lovable
│   ├── server/        # helper server-side Bunq → [[11 - Pagamenti Bunq]]
│   ├── assets/        # immagini/asset importati
│   └── test/          # unit test (Vitest)
├── api/               # Vercel Functions → [[10 - API Vercel]]
│   ├── payments/bunq/ # bank-transfer, request, status, webhook
│   ├── bookings/      # invite
│   ├── sitemap.ts
│   └── prerender.ts
├── apps/              # sotto-app → [[19 - Sub-App (pack e data)]]
│   ├── web/           # @biteproject/web
│   ├── pack/          # @biteproject/pack (build in /_pack/)
│   └── data/          # @biteproject/data (build in /_data/)
├── supabase/          # backend → [[08 - Supabase]]
│   ├── config.toml    # progetto ekwloweuicrqjjgabfdp
│   ├── functions/     # 28 Edge Functions → [[09 - Edge Functions]]
│   └── migrations/    # 36 migrazioni SQL
├── docs/              # documentazione sorgente
│   ├── bite-atlas-architecture.md  → [[15 - Semantic Layer (AI Agents)]]
│   ├── payments-bunq.md            → [[11 - Pagamenti Bunq]]
│   └── migration/SCHEMA.md
├── scripts/           # generate-sitemap, copy-subapp-builds
├── public/            # asset statici
├── dist/              # output build (generato)
├── middleware.ts      # edge middleware (prerender/routing)
├── vercel.json        # rewrite + header → [[18 - Deploy e Configurazione]]
├── vite.config.ts / tailwind.config.ts / tsconfig*.json
└── package.json       # script → [[20 - Comandi e Workflow]]
```

> Nota: ci sono cartelle duplicate con suffisso ` 2` (es. `apps/web 2`, `supabase/migrations 2`, `a - migrazione biteproject su vercel/`): artefatti di copia/migrazione, **non** parte dell'app attiva.

## File di configurazione chiave
- `components.json` — config shadcn/ui
- `eslint.config.js` — lint flat config
- `vitest.config.ts` / `playwright.config.ts` — test
- `postcss.config.js` — PostCSS/Tailwind
- `.env` — variabili Vite (vedi [[18 - Deploy e Configurazione]])

## Collegamenti
- [[01 - Architettura]] · [[02 - Stack Tecnologico]]
