---
tags: [routing, i18n, react-router]
---
# 03 - Routing e i18n

⬅️ [[Home]] · sorgente: `apps/web/src/App.tsx`, `apps/web/src/lib/i18n.tsx`, `apps/web/src/lib/seo.ts`

## Modello lingue
- Bilingue **IT/EN** con prefisso di rotta: `/it/*` e `/en/*`.
- Provider `I18nProvider` (`apps/web/src/lib/i18n.tsx`) espone traduzioni e lingua corrente.
- `/` reindirizza a `/it` o `/en` in base a preferenza persistita / lingua browser (`detectPreferredLang()`, `withLang()` in `apps/web/src/lib/seo.ts`); se non ci sono segnali espliciti il fallback pubblico è **italiano**.
- La preferenza persistita distingue fonte `manual` e `profile`: quando l'utente usa il selettore lingua della navbar, la scelta manuale diventa override e l'allineamento automatico alla lingua del profilo non la sovrascrive più.
- Il documento Vite monta direttamente l'app React: la vecchia boot splash non è più collegata al caricamento iniziale delle rotte, quindi `/`, `/it` e `/en` mostrano subito il sito.
- **Redirect legacy**: vecchi URL senza prefisso (`/logbook`, `/voyages`, `/about`→`/crew`, `/linktree`→`/links`, ecc.) vengono reindirizzati alla variante localizzata via `LegacyLangRedirect` e componenti dedicati (`LegacyVoyageRedirect`, `LegacyArticleRedirect`, `LegacyStoryRedirect`).

## Superfici bilingui oltre le rotte

Il bilinguismo non riguarda solo le pagine: vale per **qualunque** testo che raggiunga un utente reale — toast ed errori UI, email transazionali, push. Le superfici allineate di recente:

- `apps/web/src/pages/BookingRefund.tsx` — pagina rimborsi, ~30 stringhe, pattern `useI18n` + ternari.
- `apps/web/src/pages/UserBookings.tsx` — 16 messaggi di errore.
- `apps/web/src/pages/ArticleEditor.tsx` — 21 toast.
- `dispatch-community-live-notifications` — push live BITE Crew, lingua risolta per destinatario da `preferred_language` invece di testo IT fisso → [[09 - Edge Functions]].

Il pattern da seguire su un messaggio nuovo non è "IT ora, EN dopo": la stringa nasce già in entrambe le lingue, e la lingua del destinatario si **risolve** (profilo `preferred_language`, route `/it` vs `/en` al momento dell'invio, `user_metadata.lang`), non si assume. Il fallback italiano vale solo in assenza totale di segnali. Riferimento operativo completo in `AGENTS.md`.

## Rotte pubbliche localizzate (`/it/*` e `/en/*`)
Definite in `LocalizedRoutes` (App.tsx):

| Path | Pagina |
|---|---|
| `` (index) | [[05 - Frontend - Pagine\|Index]] |
| `crew` | About (The Crew) |
| `manifesto` | Manifesto |
| `logbook` | Journal |
| `logbook/:slug` | ArticlePage |
| `logbook/story/:slug` | StoryPage |
| `voyages` | Voyages |
| `voyages/:voyageRef` | VoyagePage |
| `links` | Links (linktree) |
| `collaborations` | Collaborations |
| `contact` | Contact |
| `*` | NotFound |

## Rotte trasversali (non localizzate)
- `/profile/:id` — profilo pubblico
- `/bookings`, `/bookings/:id/participants` — area prenotazioni utente ([[13 - Booking Voyage]])
- `/unsubscribe`, `/newsletter/confirm` — [[12 - Newsletter ed Email]]
- `/privacy-policy`, `/cookie-policy` — legali
- `/login`, `/signup`, `/complete-profile` — auth utente centralizzata su `login.biteproject.it`; se questi path vengono aperti dal dominio principale o da una sub-app, il middleware li sposta sul sottodominio login preservando `redirect`.
- `/profile` — profilo (AdminProfile riusato)

## Rotte admin (sottodominio `admin.`)
Protette da `AdminRoute`. Vedi [[16 - Admin]].
- `/admin/login`
- `/admin` (dashboard)
- `/admin/bookings`, `/admin/candidates`, `/admin/media`, `/admin/trackers`
- `/admin/article/:id` (editor)

`RequireMainHost` tiene le rotte marketing fuori dal sottodominio admin; `RequireLoginHostForAuth` forza login/signup/completamento profilo su `login.biteproject.it`; `RootLangRedirect` porta `/` → `/admin` quando si è su host admin. Logica host in `apps/web/src/lib/admin-host.ts`.

## Auth cross-subdomain

- Host dedicato: `login.biteproject.it`.
- Slug bridge: `/login` e `/signup` nelle sub-app (`apps/pack`, `apps/data`, `apps/crew`) reindirizzano al login host con `redirect` assoluto di ritorno.
- Storage sessione: cookie/local storage Supabase condiviso su `.biteproject.it` tramite `createSharedSupabaseAuthStorage`, così il login centralizzato è visibile anche da `crew.biteproject.it`, `pack.biteproject.it`, `data.biteproject.it` e `admin.biteproject.it`.
- Redirect consentiti: il client accetta solo path interni o URL `https://*.biteproject.it`, evitando open redirect verso domini esterni.
- In sviluppo locale i bridge usano `VITE_LOGIN_URL` se presente, altrimenti `http://127.0.0.1:5173`.
- Supabase Auth deve avere in allow-list gli URL del login host e gli URL di ritorno BITE usati in produzione.

## SEO & prerender
- `SeoManager` + `StructuredData` (JSON-LD) sulle pagine pubbliche.
- Sitemap dinamica via `/api/sitemap` (rewrite in `vercel.json` da `/sitemap-live.xml`) e `scripts/generate-sitemap.mjs` in build.
- `x-default` e la shell HTML iniziale puntano alla home italiana (`/it`) per evitare che Google Italia mostri titolo/descrizione inglesi sulla root.
- Prerender per crawler: `apps/web/api/prerender.ts` + `middleware.ts`. Le pagine indice `/it|en/logbook` e `/it|en/voyages` servono HTML con link `<a>` bilingui verso tutti gli articoli/viaggi pubblici; le pagine dettaglio includono testo, metadati, JSON-LD e link interni.
- Le pagine statiche ad alto intento SEO (`/crew`, `/collaborations`) hanno metadati e contenuto prerender dedicati: `/crew` espone Spritz come **Deerberg Beryll 32** e la ciurma; `/collaborations` espone collaborazioni con ricercatori, citizen science, creator/editoriale, brand partnership e documentazione da uso reale in mare.
- Gli URL pubblici legacy senza prefisso lingua (`/logbook`, `/voyages`, `/manifesto`, ecc.) vengono reindirizzati a `/it/*` o `/en/*` già in middleware, prima del prerender, per evitare duplicati indicizzabili.
- Header `X-Robots-Tag: noindex` su `/admin*`, `/login`, `/signup`, `/bookings`, `/profile`, `/newsletter/confirm` (in `vercel.json`).

## Collegamenti
- [[05 - Frontend - Pagine]] · [[18 - Deploy e Configurazione]] · [[15 - Semantic Layer (AI Agents)]]
