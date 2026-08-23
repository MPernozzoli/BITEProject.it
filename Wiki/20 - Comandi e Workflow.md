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

Al 2026-08-15 `tsc` è **pulito**: zero errori. Non esiste più una baseline di errori "noti" da ignorare, quindi qualunque errore compaia è stato introdotto dal lavoro in corso.

## Testing
- **Unit/component:** Vitest + Testing Library → `apps/web/src/test/`, config `apps/web/vitest.config.ts`. Copertura reale bassa (~7-8%): nessuna pagina o componente admin è coperto da test.
- **E2E:** Playwright → `apps/web/playwright.config.ts`, `apps/web/playwright-fixture.ts`.
- **Lint:** ESLint segnala gli `any` come warning progressivi; gli errori bloccanti restano riservati a bug probabili (es. Rules of Hooks, import non supportati, direttive TS unsafe).
- 🔴 **`npm run lint` e `npm run test` non funzionano su questa macchina** — stessa causa, vedi sotto.
- Un problema distinto e già risolto: il symlink `node_modules/.bin/eslint` dirottato dalla cache npm-compat di Deno, tipicamente dopo un `npx deno@2 check` lanciato dalla root invece che da `apps/web`. Si risolve con `rm -rf node_modules/.deno && npm install`. Oggi la cache `.deno` non è presente e i symlink sono corretti: non è questa la causa dei blocchi attuali.

## 🔴 eslint e vitest si bloccano: è la versione di Node, non i tool

**Sintomo:** `npm run lint` (`eslint .`) resta appeso a tempo indefinito; `npm run test` (`vitest run`) fallisce dopo 120s con `[vitest-pool-runner]: Timeout waiting for worker to respond`, un errore per file di test, **zero test eseguiti**.

**Diagnosi (2026-08-15).** Campionando lo stack dei due processi con `sample <pid>`, entrambi risultano fermi nello stesso identico punto del runtime Node:

```
node::loader::ModuleWrap::Evaluate
  v8::internal::SyntheticModule::Evaluate
    node::loader::ModuleWrap::SyntheticModuleEvaluationStepsCallback
```

Due tool indipendenti (eslint 9.32, vitest 4.1.10 / Vite 8.1.4) che si inchiodano nella valutazione dei **moduli ESM sintetici** di Node non sono due bug applicativi: è il runtime. La macchina gira **Node 25.2.1** (non-LTS), mentre il repo dichiara `engines.node: "24.x"` e `.nvmrc: 24` — cioè la major su cui gira Vercel e su cui questo stack è supportato.

Cose **escluse** con test diretti, per non rifare il giro:
- non è la rete (`registry.npmjs.org` risponde 200 in 0.3s);
- non è lo spazio nel path `Unreal Projects` — il `%20` nelle stack trace è solo il formato ESM di Node, e `distDir` di vitest usa correttamente `fileURLToPath`;
- non è `fork`/`worker_threads` in sé, né `serialization: "advanced"`: un fork con gli stessi identici parametri funziona;
- non sono gli `execArgv` di vitest (`--experimental-import-meta-resolve` e `--require suppress-warnings.cjs` girano entrambi senza problemi);
- non è il volume di file da lintare (295 sorgenti, `dist` già in `ignores`);
- non è la cache Deno (assente).

**Fix:** girare su Node 24. Attenzione: sulla macchina **non esiste** un Node 24 — `/opt/homebrew/opt/node@23` e `node@25` sono symlink fantasma che puntano tutti allo stesso unico Node 25.2.1 in `Cellar/node` (residuo dell'incidente di installazione descritto in [[18 - Deploy e Configurazione]]). Installare la 24 con `nvm`/`fnm`, **non** con Homebrew in parallelo: è proprio quello che aveva rotto il `node` di default per conflitto ABI su `simdjson`.

Finché si resta su Node 25, `tsc` + `npm run build` sono gli unici gate di verifica utilizzabili.
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

## Deploy Edge Functions

```bash
# Deploy singola function
supabase functions deploy <function-name> --project-ref ekwloweuicrqjjgabfdp --no-verify-jwt

# Deploy editorial-readiness-alert
supabase functions deploy editorial-readiness-alert --project-ref ekwloweuicrqjjgabfdp --no-verify-jwt

# Secret (già configurati)
supabase secrets set EDITORIAL_ALERT_CRON_SECRET=<value> --project-ref ekwloweuicrqjjgabfdp
```

Le cron jobs sono gestite da `pg_cron` nel database. Verifica con:
```sql
select jobid, schedule, command, active from cron.job where jobname like 'editorial%';
```

## Collegamenti
- [[18 - Deploy e Configurazione]] · [[19 - Sub-App (pack e data)]] · [[08 - Supabase]] · [[23 - Community]]
