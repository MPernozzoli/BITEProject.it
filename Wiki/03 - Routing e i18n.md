---
tags: [routing, i18n, react-router]
---
# 03 - Routing e i18n

⬅️ [[Home]] · sorgente: `apps/web/src/App.tsx`, `apps/web/src/lib/i18n.tsx`, `apps/web/src/lib/seo.ts`

## Modello lingue
- Bilingue **IT/EN** con prefisso di rotta: `/it/*` e `/en/*`.
- Provider `I18nProvider` (`apps/web/src/lib/i18n.tsx`) espone traduzioni e lingua corrente.
- `/` reindirizza a `/it` o `/en` in base a preferenza persistita / lingua browser (`detectPreferredLang()`, `withLang()` in `apps/web/src/lib/seo.ts`); se non ci sono segnali espliciti il fallback pubblico è **italiano**.
- Il documento Vite monta direttamente l'app React: la vecchia boot splash non è più collegata al caricamento iniziale delle rotte, quindi `/`, `/it` e `/en` mostrano subito il sito.
- **Redirect legacy**: vecchi URL senza prefisso (`/logbook`, `/voyages`, `/about`→`/crew`, `/linktree`→`/links`, ecc.) vengono reindirizzati alla variante localizzata via `LegacyLangRedirect` e componenti dedicati (`LegacyVoyageRedirect`, `LegacyArticleRedirect`, `LegacyStoryRedirect`).

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
- `/login`, `/signup`, `/complete-profile` — auth utente
- `/profile` — profilo (AdminProfile riusato)

## Rotte admin (sottodominio `admin.`)
Protette da `AdminRoute`. Vedi [[16 - Admin]].
- `/admin/login`
- `/admin` (dashboard)
- `/admin/bookings`, `/admin/candidates`, `/admin/media`, `/admin/trackers`
- `/admin/article/:id` (editor)

`RequireMainHost` tiene le rotte marketing fuori dal sottodominio admin; `RootLangRedirect` porta `/` → `/admin` quando si è su host admin. Logica host in `apps/web/src/lib/admin-host.ts`.

## SEO & SSR universale
- `SeoManager` + `StructuredData` (JSON-LD) gestiscono i metadati lato client dopo l'hydration.
- Sitemap dinamica via `/api/sitemap` (rewrite in `vercel.json` da `/sitemap-live.xml`) e `scripts/generate-sitemap.mjs` in build.
- `x-default` e la shell HTML iniziale puntano alla home italiana (`/it`) per evitare che Google Italia mostri titolo/descrizione inglesi sulla root.
- **SSR universale (nessuno sniffing dello User-Agent):** `middleware.ts` riscrive **ogni** richiesta GET/HEAD delle rotte pubbliche verso `apps/web/api/render.ts`, che recupera il contenuto da Supabase e restituisce un documento HTML completo (titolo, corpo articolo, metadati, canonical/hreflang, Open Graph/Twitter, JSON-LD `BlogPosting`/`Trip`). Il contenuto è iniettato dentro `#root` della shell SPA buildata, quindi è leggibile senza JavaScript **e** React fa il boot/hydration per l'interattività. Browser, crawler e agenti IA ricevono lo stesso HTML.
- Status: `200` per contenuti pubblicati, `404` reale per slug inesistenti o non pubblicati (bozze/programmati).
- Corpo articolo (TipTap JSON) serializzato server-side in HTML sanitizzato da `apps/web/api/_lib/tiptap-html.ts` (whitelist di tag/attributi, URL validati, iframe solo YouTube).
- Gli URL pubblici legacy senza prefisso lingua (`/logbook`, `/voyages`, `/manifesto`, ecc.) vengono reindirizzati a `/it/*` o `/en/*` già in middleware, prima dell'SSR, per evitare duplicati indicizzabili.
- Header `X-Robots-Tag: noindex` su `/admin*`, `/login`, `/signup`, `/bookings`, `/profile`, `/newsletter/confirm` (in `vercel.json`).

## Collegamenti
- [[05 - Frontend - Pagine]] · [[18 - Deploy e Configurazione]] · [[15 - Semantic Layer (AI Agents)]]
