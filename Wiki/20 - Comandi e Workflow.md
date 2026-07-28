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
- Nuove migrazioni: usare sempre `cd apps/web && supabase migration new nome_descrittivo`; non inventare timestamp a mano.
- Dopo una migrazione applicata al remoto: rigenerare tipi web e copiare in crew se la sub-app usa le nuove tabelle.

```bash
cd apps/web
supabase gen types typescript --linked --schema public > src/integrations/supabase/types.ts
cp src/integrations/supabase/types.ts ../crew/src/integrations/supabase/types.ts
```

## Workflow tipici
- **Sviluppo UI:** `npm run dev` → modifica in `apps/web/src/` → [[05 - Frontend - Pagine]] / [[06 - Frontend - Componenti]].
- **Nuovo endpoint dati pubblico:** aggiungi/modifica function `public-*` → [[15 - Semantic Layer (AI Agents)]].
- **Modifica schema:** nuova migrazione SQL + rigenera `apps/web/src/integrations/supabase/types.ts`.
- **Community:** `npm run build:crew` per la sola sub-app; `npm run build` copia poi `apps/crew/dist` in `dist/Crew`. Per lavoro su feed/live eseguire almeno `npx tsc --noEmit -p apps/crew/tsconfig.app.json`.
- **Community Supabase:** dopo modifiche RLS/RPC, eseguire `supabase db push --linked --dry-run`, poi `supabase db push --linked --yes`, poi advisor filtrati sui nuovi oggetti.
- **Edge Function community live push:** deploy con `cd apps/web && supabase functions deploy dispatch-community-live-notifications --no-verify-jwt --use-api`.
- **Deploy:** push su `main` → Vercel build (`npm run build`) → [[18 - Deploy e Configurazione]].

## Workflow agenti AI
- Gli agenti devono indicare esplicitamente ogni passaggio che richiede un'azione umana, distinguendolo dalle attività completate in autonomia.
- Prima di chiedere interventi manuali, gli agenti devono predisporre quanto più possibile: generare valori configurabili localmente quando opportuno, preparare file/comandi e indicare con precisione dove inserire chiavi, token o segreti.
- Quando un'implementazione introduce o modifica migrazioni Supabase, gli agenti devono applicarle autonomamente al termine del lavoro e verificarne l'esito. Se credenziali o accessi mancanti lo impediscono, devono lasciare istruzioni operative complete e segnalare il blocco come azione richiesta all'umano.

## Note package manager
Usare npm come package manager operativo del progetto. `package-lock.json` è il lockfile da aggiornare quando si interviene sulle dipendenze.
Per `@pynkstudio/mailapp` usare il tarball GitHub pubblico già presente in `package.json`, **pinnato a un tag** (`archive/refs/tags/vX.Y.Z.tar.gz`): non `refs/heads/main`, e non la forma `github:owner/repo#tag` che npm può risolvere via SSH e che fallisce su Vercel. L'install richiede `--legacy-peer-deps` finché il package dichiara peer React 19 e questa app resta su React 18 (il mailbox runtime usato qui non è React, quindi il peer non è un problema reale).

Quando si cambia la logica mail, l'intervento va fatto **nel package** (`~/Documents/Unreal Projects/siti/pynkstudio-mailapp`), non qui:
```bash
npm run typecheck && npm run test && npm run build   # nel repo del package
git add -A && git commit && git tag vX.Y.Z && git push origin main --tags
```
Poi aggiornare l'URL del tarball in `apps/web/package.json` e reinstallare. `dist/` è committato di proposito, perché gli install da tarball GitHub non eseguono la build.

## Collegamenti
- [[18 - Deploy e Configurazione]] · [[19 - Sub-App (pack e data)]] · [[08 - Supabase]] · [[23 - Community]]
