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
| `npm run lint` | ESLint su **tutti** i workspace con uno script `lint` (`--workspaces --if-present`), non più solo `apps/web` |
| `npm run test` | Vitest di `@biteproject/web` (run singolo) |
| `npm run test:watch` | Vitest di `@biteproject/web` in watch |
| `npm run --workspace @biteproject/web seo:sitemap` | genera sitemap (`apps/web/scripts/generate-sitemap.mjs`) |

## Type-check — non c'è nessuno script npm che lo faccia

**`npm run build` non esegue type-check** (`"build": "npm run seo:sitemap && vite build"`, e Vite transpila senza controllare i tipi). Una build verde non dice niente sui type error: vanno cercati esplicitamente.

```bash
cd apps/web && npx tsc --noEmit -p tsconfig.app.json
```

Usare **`tsconfig.app.json`, non `tsconfig.json`**: quest'ultimo è solo un project reference con `files: []`, controlla zero file ed esce pulito qualunque cosa sia rotta — falsa sicurezza. Per le sub-app vale lo stesso schema (`apps/crew/tsconfig.app.json`, ecc.).

La verifica completa prima di un commit è quindi **due comandi**: `tsc --noEmit -p tsconfig.app.json` *e* `npm run build --workspace @biteproject/web`.

> Nota: `noUnusedLocals` / `noUnusedParameters` sono disattivati. Dopo un refactor che sposta codice fuori da un file, gli import rimasti inutilizzati nel file di partenza **non vengono segnalati da nessun tool**: vanno cercati a mano.

### Errori TypeScript preesistenti (baseline nota)
Girando `tsc` su `apps/web` compaiono errori **non introdotti dalle modifiche in corso**. Prima di attribuirsi una regressione, confrontare l'output con questa lista:
- `VoyageWaypoint` (`src/lib/voyage-utils.ts`) richiede `updated_at`, ma `normalizeWaypoint` in `AdminVoyageManager.tsx` e le fixture di `src/test/voyage-utils.test.ts` costruiscono l'oggetto senza fornirlo.
- `src/pages/VoyagePage.tsx` referenzia `fixedMinimumEur` su un tipo che ora espone solo `contributionPerNmEur`.

Se compaiono **solo** questi (a numeri di riga eventualmente diversi), il lavoro in corso è pulito.

## Testing
- **Unit/component:** Vitest + Testing Library → `apps/web/src/test/`, config `apps/web/vitest.config.ts`. Copertura reale bassa (~7-8%): nessuna pagina o componente admin è coperto da test.
- **E2E:** Playwright → `apps/web/playwright.config.ts`, `apps/web/playwright-fixture.ts`.
- **Lint:** ESLint segnala gli `any` come warning progressivi; gli errori bloccanti restano riservati a bug probabili (es. Rules of Hooks, import non supportati, direttive TS unsafe).
- ⚠️ **`npm run lint` è inaffidabile:** `eslint` si blocca a tempo indefinito (osservato anche su `eslint --version`, con processi zombie da terminare a mano). Causa non diagnosticata. Un problema correlato ma distinto — il symlink `node_modules/.bin/eslint` dirottato dalla cache npm-compat di Deno, tipicamente dopo un `npx deno@2 check` lanciato dalla root invece che da `apps/web` — si risolve con `rm -rf node_modules/.deno && npm install`. Finché il blocco non è capito, non usare il lint come gate di verifica: usare `tsc` + build.
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

## Server MCP admin → [[25 - MCP Admin]]
```bash
# ispezione manuale dei tool (serve un token bite_mcp_... generato da /profile)
npx @modelcontextprotocol/inspector

# collegare Claude Code al backoffice
claude mcp add --transport http bite-admin https://admin.biteproject.it/mcp --header "Authorization: Bearer <token>"
```
I test dei tool girano con il resto della suite: `src/test/mcp-*.test.ts` usano un client MCP reale su transport in-memory e uno stub del client Supabase (`src/test/mcp-stub-supabase.ts`), quindi non toccano rete né database.

## Note package manager
Usare npm come package manager operativo del progetto. `package-lock.json` è il lockfile da aggiornare quando si interviene sulle dipendenze.
Per `@pynkstudio/mailapp` e `@pynkstudio/newsletterapp` usare il tarball GitHub pubblico già presente in `package.json`: non `refs/heads/main`, e non la forma `github:owner/repo#tag` che npm può risolvere via SSH e che fallisce su Vercel.

I due package usano **granularità di pin diverse, di proposito**:
- `@pynkstudio/mailapp` → **commit SHA** (`archive/<sha>.tar.gz`). Un tag git è mutabile — si può ripuntare — e un tarball GitHub non ha integrity hash nel lock, quindi il pin a tag non garantisce che due install a distanza di tempo scarichino lo stesso codice.
- `@pynkstudio/newsletterapp` → **tag** (`archive/refs/tags/vX.Y.Z.tar.gz`), lasciato tale intenzionalmente: `apps/web/supabase/functions/_shared/newsletterapp.ts` dichiara quel pin-per-tag come unica fonte di verità della versione, e i due pin devono restare identici (sotto). Non convertirlo a SHA senza aggiornare in coppia anche quel file.

Per mailapp l'install richiede `--legacy-peer-deps` finché il package dichiara peer React 19 e questa app resta su React 18 (il mailbox runtime usato qui non è React, quindi il peer non è un problema reale); newsletterapp non ha peer dependencies.

Quando si cambia la logica mail o newsletter, l'intervento va fatto **nel package**, non qui —
`~/Documents/Unreal Projects/siti/pynkstudio-mailapp` e `~/Documents/Unreal Projects/siti/pynkstudio-newsletterapp`:
```bash
npm run typecheck && npm run test && npm run build   # nel repo del package
git add -A && git commit && git tag vX.Y.Z && git push origin main --tags
```
Poi aggiornare l'URL del tarball in `apps/web/package.json` e reinstallare. `dist/` è committato di proposito, perché gli install da tarball GitHub non eseguono la build.

Per **newsletterapp** ci sono due pin da aggiornare, non uno:
1. il tarball in `apps/web/package.json` (route Vercel + console admin);
2. l'URL raw in `apps/web/supabase/functions/_shared/newsletterapp.ts` (edge function), che usa l'albero `deno/` — anche quello committato, perché Deno lo scarica direttamente.

Le edge function si deployano separatamente dall'app web: se i due pin divergono, i due runtime eseguono versioni diverse della stessa logica.

Verifica delle edge function dopo un cambio (nessun Deno installato di default, `npx` lo scarica):
```bash
cd apps/web && npx deno@2 check --no-lock --node-modules-dir=auto supabase/functions/newsletter-*/index.ts
```
Rimuovere `apps/web/node_modules` dopo: `--node-modules-dir=auto` lo crea per risolvere gli specifier `npm:`.

## Collegamenti
- [[18 - Deploy e Configurazione]] · [[19 - Sub-App (pack e data)]] · [[08 - Supabase]] · [[23 - Community]]
