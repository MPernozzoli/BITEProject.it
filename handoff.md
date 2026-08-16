# Handoff — audit generico BITEProject.it

Contesto per chi riprende questo lavoro in una nuova sessione: qui non c'è memoria della chat precedente, quindi questo file deve bastare da solo. Aggiornato 2026-08-15.

## Cos'è successo

L'utente ha chiesto un audit generico del monorepo (BITEProject.it: `apps/web` + `apps/pack` + `apps/data` + `apps/crew`, Vite + Supabase, deploy Vercel). Sono seguiti diversi giri di fix a severità decrescente, e infine un refactor strutturale di `apps/web/src/components/admin/AdminVoyageManager.tsx` (4330 → 3410 righe), completato in 5 step verificati.

## ⚠️ Fatti operativi critici — leggere prima di toccare qualunque cosa

1. **Ogni commit su questo repo viene auto-committato e auto-pushato su GitHub (`MPernozzoli/BITEProject.it`, pubblico), e Vercel auto-deploya `main` in produzione.** Non c'è staging, non c'è review gate. Il meccanismo non è stato attivato consapevolmente in nessuna sessione osservata — è il workflow di fatto di questo repo da mesi (verificabile: quasi ogni commit storico su `main` ha un deployment Vercel `production` corrispondente, stesso autore). Trattare ogni modifica come se finisse in produzione pochi minuti dopo averla scritta.
2. **`npm run build` NON esegue type-check completo** (`apps/web/package.json`: `"build": "npm run seo:sitemap && vite build"`). Usare **entrambi**: `cd apps/web && npx tsc --noEmit -p tsconfig.app.json` (non `tsconfig.json`: quello è solo un project-reference con `files: []`, controlla zero file, dà falsa sicurezza) e poi `npm run build --workspace @biteproject/web` dalla root.
3. **`apps/web/public/sitemap.xml` viene rigenerato ad ogni build** (script `seo:sitemap`, pulls live data). Dopo ogni build locale, `git status` lo mostra come modificato — è rumore, non una modifica reale: `git checkout -- apps/web/public/sitemap.xml` prima di guardare lo stato.
4. **`tsc` è pulito dal 2026-08-15** (era una lista di errori preesistenti da ignorare a mano, ora chiusa). Non c'è più nessuna baseline: se `tsc` segnala qualcosa, l'hai introdotto tu.
5. **Node locale: v25.2.1 (non-LTS) via Homebrew, non 24.x come Vercel.** In una sessione precedente installare `node@24` in parallelo ha rotto silenziosamente il `node` di default (conflitto di versione ABI sulla libreria condivisa `simdjson`, sintomo: `dyld: Library not loaded: .../libsimdjson.29.dylib`). Fix già applicato: `node@24` disinstallato, `/opt/homebrew/opt/simdjson` ripuntato a mano alla versione 4.2.2 (compatibile con node 25.2.1). **Non reinstallare `node@24` senza sapere che romperà di nuovo il default** — se serve testare su Node 24, valutare `nvm`/`fnm` invece di Homebrew, o accettare che si romperà e rifare il fix del symlink dopo.
6. **L'account di test (`claude-test@biteproject.it`, credenziali in `AGENTS.md`) NON è admin.** Le pagine `/admin/*` (incluso `AdminVoyageManager`) non sono verificabili in browser da un agente in questa sessione — la verifica end-to-end resta un passaggio umano.
7. **`npm run lint` E `npm run test` sono entrambi inutilizzabili su questa macchina, per colpa di Node 25** (dettaglio e prove nella sezione "Punto 4" più sotto, e in `Wiki/20 - Comandi e Workflow.md`). Non è eslint e non è vitest: entrambi si inchiodano nello stesso frame del runtime (`SyntheticModule::Evaluate`). **Il repo non ha copertura di test verificabile finché non si passa a Node 24.** Gli unici gate di verifica affidabili oggi sono `tsc` + `npm run build`.

## Fatto in questa sessione (in ordine)

### 1. Audit iniziale
5 agenti paralleli su: config/struttura monorepo, qualità codice frontend, sicurezza/coerenza Supabase, conformità i18n IT/EN, dipendenze/sicurezza generale.

### 2. Fix alta severità
- `backups/` rimosso dal tracking git (aggiunto a `.gitignore`, file conservati su disco).
- `apps/web/src/pages/BookingRefund.tsx` bilinguizzato (~30 stringhe, pattern `useI18n` + ternari).
- `dispatch-community-live-notifications` (edge function) ora risolve `preferred_language` per destinatario invece di testo IT fisso.
- (Un presunto 4° problema — autorizzazione mancante su `sync-article-community-post` — si è rivelato un falso positivo: il controllo c'era già.)

### 3. Fix media/bassa severità
`npm audit fix` (2/4 vulnerabilità risolte; `react-router` v6→v7 resta, vedi sotto), header di sicurezza su `vercel.json` (no CSP, volutamente — richiederebbe mappare tutti i domini esterni e testare in browser), confronto a tempo costante in `handle-email-suppression`, `bun.lock` rimosso, `apps/web/middleware.ts` rimosso (dead code, Vercel usa solo quello di root), `.nvmrc`+`engines` aggiunti, lint esteso a tutte le sub-app in `package.json` root.

### 4. Verifica Supabase via MCP (server già autorizzato in sessione, project id `ekwloweuicrqjjgabfdp`)
- RLS confermata a posto su tutte le tabelle sensibili (`get_advisors`).
- `apps/web/src/integrations/supabase/types.ts` e `apps/crew/.../types.ts` rigenerati (erano obsoleti, causa dei cast `as any` in `ArticleEditor.tsx`).
- Migration `20260812120000_pin_function_search_path.sql` creata e applicata al DB live (2 funzioni con `search_path` mutabile).
- `@pynkstudio/mailapp` pinnato a commit SHA invece che a tag mutabile. `@pynkstudio/newsletterapp` **lasciato sul tag di proposito** — `apps/web/supabase/functions/_shared/newsletterapp.ts` ha un commento esplicito che dichiara quel pin-per-tag l'unica fonte di verità voluta dal progetto; non toccarlo senza aggiornare anche quel file in coppia.

### 5. Altri fix
- `apps/web/src/pages/UserBookings.tsx`: 16 messaggi di errore bilinguizzati.
- `apps/web/src/pages/ArticleEditor.tsx`: 21 toast bilinguizzati + bug slug auto-generazione risolto (flag `slugManuallyEdited`/`slugItManuallyEdited`/`slugEnManuallyEdited`) + `useEffect` di init sistemato con `useCallback`.
- `apps/crew/src/integrations/supabase/client.ts`: tipato con `Database` invece di `any`.
- `zod`/`@hookform/resolvers` allineati a v3 su tutte e 4 le sub-app (`apps/pack` era su v4, downgrade verificato sicuro: unico uso in `Contact.tsx` era già sintassi v3-compatibile).

### 6. Refactor `AdminVoyageManager.tsx` (vedi anche `/Users/mpernozzoli/.claude/plans/majestic-hugging-eclipse.md` se ancora presente)
4 componenti presentazionali estratti come file fratelli in `apps/web/src/components/admin/`, più un fix di bug isolato:
1. `VoyageListPanel.tsx` — filtri + lista viaggi (224 righe originali).
2. `VoyageAddressSearchPanel.tsx` — solo ricerca indirizzi land-only; la card "Rigenera geometria" adiacente è rimasta nel padre (dominio logico diverso: salvataggio rotta, non ricerca).
3. `VoyageFormPanel.tsx` — form info viaggio (521 righe, il più grande).
4. `WaypointListPanel.tsx` — lista waypoint con drag&drop; richiedeva un precompute (`selectedWaypointEventLabels`, `useMemo` nel padre) per evitare un reverse-import di una funzione module-privata del padre.
5. **Fix bug separato**: cambiare lingua IT/EN nell'admin distruggeva e ricreava l'intera istanza Maplibre (camera/zoom resettati) — causa: `insertWaypointAtIndex` leggeva `lang` direttamente ed era quindi nel dependency array dell'effect di bootstrap mappa. Fix: `langRef` sincronizzato via `useEffect`, letture dirette sostituite con `langRef.current`.

**Pattern seguito** (già presente nel codebase, precedente diretto: `apps/web/src/pages/AdminVoyageBookings.tsx` scomposto in 5 file fratelli, incluso `WaypointEditorPanel.tsx` già usato da `AdminVoyageManager.tsx`):
- Cartella **piatta**, niente sottocartelle né barrel file.
- Ogni componente estratto: `export default Componente` + `export interface ComponenteProps`.
- **Presentazionale puro**: riceve dati e handler via props, zero chiamate Supabase interne — il file padre resta l'unico proprietario di stato/fetch/mutazioni.
- Tipi condivisi: `export` aggiunto alle interface già esistenti nel padre, `import type { X } from "@/components/admin/AdminVoyageManager"` nel figlio (nessun ciclo runtime, il progetto ha `isolatedModules: true`).
- Verifica per ogni step: estrai → `tsc` (confronta con la lista errori preesistenti sopra) → build reale → grep manuale per import ora inutilizzati nel padre (il progetto ha `noUnusedLocals`/`noUnusedParameters` disattivati, quindi tooling non li segnala da solo) → commit (auto-deploya).

Ogni step di questo refactor è stato verificato con `tsc` + build, ma **mai con smoke-test in browser** (vedi punto 6 sopra). Prima di fidarsi ciecamente che l'admin funzioni ancora com'era, un umano dovrebbe controllare in produzione: apri/chiudi form viaggio, filtri lista, ricerca indirizzi (viaggio land), drag&drop + rename inline sui waypoint, cambio lingua con mappa aperta.

## Sessione 2026-08-14 (ripresa)

Verificato che il working tree lasciato dalla sessione precedente è sano: `npx tsc --noEmit -p tsconfig.app.json` restituisce **solo** gli errori preesistenti elencati al punto 4 (nessuna regressione dal refactor), e `npm run build --workspace @biteproject/web` passa.

**Colmato il debito documentale del vault Obsidian** (era il punto 2 della lista sotto). 11 note aggiornate:

| Nota | Cosa è stato scritto |
|---|---|
| `03 - Routing e i18n` | nuova sezione "Superfici bilingui oltre le rotte": BookingRefund, UserBookings, toast ArticleEditor, push live per-destinatario |
| `04 - Struttura Repository` | corretto: `middleware.ts` **non** è un symlink e `apps/web/middleware.ts` non esiste più (la nota lo dava per symlink, era sbagliata già prima); aggiunti `backups/` e `.nvmrc` |
| `05 - Frontend - Pagine` | fix slug auto-generazione di `ArticleEditor` (i 3 flag `slug*ManuallyEdited`) e perché conta |
| `06 - Frontend - Componenti` | i 4 pannelli estratti, il pattern di estrazione, il fix `langRef` sulla mappa |
| `08 - Supabase` | migration `20260812120000_pin_function_search_path.sql`; hardening: niente più `search_path` mutabile, RLS riverificata |
| `09 - Edge Functions` | lingua per-destinatario in `dispatch-community-live-notifications`, confronto a tempo costante in `handle-email-suppression` |
| `16 - Admin` | rimando alla scomposizione di `AdminVoyageManager` |
| `18 - Deploy e Configurazione` | tabella header di sicurezza di `vercel.json` + perché niente CSP; auto-deploy senza staging; `.nvmrc`/`engines`; sitemap rigenerata a ogni build; build ≠ type-check |
| `19 - Sub-App` | 4 copie del client Supabase e obbligo di tiparle con `Database`; `zod`/`@hookform/resolvers` da tenere allineati |
| `20 - Comandi e Workflow` | **nuova sezione "Type-check"** con la baseline degli errori preesistenti, `lint` ora su tutti i workspace, warning su eslint che si blocca, pin mailapp (SHA) vs newsletterapp (tag) |
| `23 - Community` | corretto riferimento residuo a `apps/web/middleware.ts` |

### Punto 3 — errori TypeScript preesistenti: **CHIUSO**
`tsc --noEmit -p tsconfig.app.json` ora esce **pulito**, zero errori. Non c'è più una baseline da confrontare a mano: qualunque errore compaia d'ora in poi è stato introdotto adesso.
- `AdminVoyageManager.tsx` / `normalizeWaypoint`: aggiunto `updated_at` con fallback su `created_at`. La funzione normalizza ogni altro campo con un default — `updated_at` era l'unico requisito di `VoyageWaypoint` lasciato scoperto. Il fallback su `created_at` (già obbligatorio in `WaypointRecord`) copre i waypoint creati localmente (drag sulla mappa, bozze da `localStorage`) senza infilare `new Date()` dentro un normalizzatore.
- `VoyagePage.tsx`: `contributionFixedMinimumEur(contributionOpts.fixedMinimumEur)` → `contributionFixedMinimumEur()`. **Non è un cambio di comportamento**: non esiste una colonna DB per un minimo fisso per-viaggio, `contributionOpts` non ha mai portato quel campo, quindi a runtime era già `undefined` e la funzione già ritornava il default (€20).
- `src/test/voyage-utils.test.ts`: `updated_at: ""` aggiunto alle 8 fixture.

Verificato con `tsc` pulito + `npm run build` verde.

### Punto 4 — eslint bloccato: **DIAGNOSTICATO** (fix = azione umana)
Non è eslint, ed è più grave di quanto sembrasse: **anche `npm run test` non funziona**, cosa che la sessione precedente non aveva rilevato (`vitest run` fallisce dopo 120s con `Timeout waiting for worker to respond`, **zero test eseguiti** su 22 file).

Campionando lo stack di entrambi i processi con `sample <pid>`, eslint e vitest si inchiodano nello **stesso identico frame** del runtime Node: `SyntheticModule::Evaluate` → `SyntheticModuleEvaluationStepsCallback`. Due tool indipendenti fermi nello stesso punto = problema di runtime, non applicativo. La macchina gira **Node 25.2.1** mentre il repo dichiara `engines.node: 24.x` / `.nvmrc: 24`.

Escluso con test diretti (documentato in `Wiki/20` per non far rifare il giro): rete, lo spazio nel path `Unreal Projects`, `fork`/`worker_threads`, `serialization: "advanced"`, gli `execArgv` di vitest, il volume di file da lintare, la cache Deno.

**Azione richiesta all'umano:** installare Node 24 con `nvm` o `fnm` e rilanciare `npm run lint` / `npm run test`. Sulla macchina **non c'è** un Node 24: `/opt/homebrew/opt/node@23` e `node@25` sono symlink fantasma allo stesso unico Node 25.2.1. **Non installarlo da Homebrew** — è esattamente ciò che aveva rotto il `node` di default (conflitto ABI `simdjson`).

```bash
curl -fsSL https://fnm.vercel.app/install | bash && exec $SHELL && fnm install 24 && fnm use 24
```

Punti 1 (smoke-test umano) e 5-10 della lista sotto: **non toccati**, restano aperti.

## Stato del repo adesso

Non committato (in attesa dell'auto-commit, o di un commit manuale):
```
M apps/crew/src/integrations/supabase/client.ts
M apps/pack/package.json
M apps/web/src/components/admin/AdminVoyageManager.tsx
M package-lock.json
?? apps/web/src/components/admin/VoyageAddressSearchPanel.tsx
?? apps/web/src/components/admin/VoyageFormPanel.tsx
?? apps/web/src/components/admin/VoyageListPanel.tsx
?? apps/web/src/components/admin/WaypointListPanel.tsx
?? apps/web/supabase/migrations/20260812120000_pin_function_search_path.sql
```
Ultimo commit su `main` (locale e remoto, sincronizzati): `a9977ee "Add booking contribution types and i18n fixes"`.

## Cosa resta da fare, in ordine di priorità/rischio crescente

1. **Smoke-test umano** del refactor `AdminVoyageManager.tsx` (vedi sopra) — prima di tutto il resto.
2. ~~**Vault Obsidian non aggiornato**~~ — **fatto il 2026-08-14**, vedi sezione "Sessione 2026-08-14" sopra.
3. ~~**Errori TypeScript preesistenti**~~ — **chiuso il 2026-08-15**, `tsc` è pulito.
4. ~~**Toolchain `eslint`**~~ — **diagnosticato il 2026-08-15**: è Node 25 vs `engines: 24.x`, e travolge anche `vitest`. Resta l'azione umana di installare Node 24.
5. **Refactor dei file grandi** — **fatto il 2026-08-15 su 3 file su 5**, stesso pattern di `AdminVoyageManager.tsx`:
   - `AdminVoyageBookings.tsx` 2754 → 1896 (−31%): 4 pannelli (uno per tab) + `lib/booking-planning.ts` (14 helper puri).
   - `ArticleEditor.tsx` 3079 → 2564 (−17%): pannello geo/viaggio, pannello SEO, overlay anteprima, gruppo dialog. `getWaypointOptionLabel` spostata in `lib/voyage-utils.ts`.
   - `AdminProfile.tsx` 2359 → 1694 (−28%): card Preferenze + `lib/profile-copy.ts` (~300 righe di copy IT/EN).
   - `Journal.tsx` 1988 → 1845 (−7%): barra statistiche della vista mappa.
   - **`UserBookings.tsx` lasciato intero, deliberatamente.** Ogni blocco candidato richiede 22-52 props: i valori derivati da `detailsRequest` servono sia al dialog di dettaglio sia al resto della pagina, quindi la derivazione non può scendere nel figlio. Estrarre aggiungerebbe uno strato di prop-passing senza ridurre la complessità. Stesso motivo per la sidebar articoli di `Journal.tsx` (46 props). Per quelle due serve prima ristrutturare la proprietà dello stato — cambiamento di comportamento, non movimento di codice, quindi non affrontabile senza test funzionanti.
   - Verifica di ogni singolo step: `tsc` pulito + `npm run build` verde. Ripuliti a mano ~45 import diventati orfani (`noUnusedLocals` è off, nessun tool li segnala).
   - **Mai verificato in browser** — vale lo stesso avvertimento del punto 1.
6. **Copertura test** (~7-8%, nessuna pagina/componente admin testato) — lavoro esteso, non un fix puntuale.
7. **`zod` v3/v4** ora allineato (fatto), ma se in futuro diverge di nuovo: verificare l'uso reale prima di scegliere la direzione del downgrade/upgrade (in questo caso è bastato un grep, ma non è garantito che sia sempre così semplice).
8. **`react-router` v6→v7** — 2 vulnerabilità npm moderate residue richiedono questo major bump. Deliberatamente non fatto: tocca il routing di tutte e 4 le sub-app, rischio alto per un sito che si autodeploya senza staging, non pienamente verificabile in questa sessione (browser testing su tutte le rotte richiederebbe più tempo di quanto investito qui).
9. **Deduplica client Supabase** (4 copie quasi identiche tra le sub-app) — architetturale, deliberatamente non fatto per non introdurre un'astrazione non richiesta.
10. **CSP** su `vercel.json` — deliberatamente omessa (richiede mappare tutti i domini esterni: Supabase, OpenAI, mappe, OAuth social, e testare in browser che nulla si rompa).

## Riferimenti

- Audit completo e cronologia dei fix: solo in questa chat/sessione (non persistito altrove oltre a questo file).
- Piano dettagliato del refactor `AdminVoyageManager.tsx` (se il file esiste ancora): `/Users/mpernozzoli/.claude/plans/majestic-hugging-eclipse.md`.
- Credenziali test/Supabase, regole i18n, regole sui package condivisi (`mailapp`/`newsletterapp`): `AGENTS.md` in root.
