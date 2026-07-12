---
tags: [routing, i18n, react-router]
---
# 03 - Routing e i18n

⬅️ [[Home]] · sorgente: `src/App.tsx`, `src/lib/i18n.tsx`, `src/lib/seo.ts`

## Modello lingue
- Bilingue **IT/EN** con prefisso di rotta: `/it/*` e `/en/*`.
- Provider `I18nProvider` (`src/lib/i18n.tsx`) espone traduzioni e lingua corrente.
- `/` reindirizza a `/it` o `/en` in base a preferenza persistita / lingua browser (`detectPreferredLang()`, `withLang()` in `src/lib/seo.ts`).
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
- `/admin/bookings`, `/admin/media`, `/admin/trackers`
- `/admin/article/:id` (editor)

`RequireMainHost` tiene le rotte marketing fuori dal sottodominio admin; `RootLangRedirect` porta `/` → `/admin` quando si è su host admin. Logica host in `src/lib/admin-host.ts`.

## SEO & prerender
- `SeoManager` + `StructuredData` (JSON-LD) sulle pagine pubbliche.
- Sitemap dinamica via `/api/sitemap` (rewrite in `vercel.json` da `/sitemap-live.xml`) e `scripts/generate-sitemap.mjs` in build.
- Prerender per crawler: `api/prerender.ts` + `middleware.ts`. Le pagine indice `/it|en/logbook` e `/it|en/voyages` servono HTML con link `<a>` bilingui verso tutti gli articoli/viaggi pubblici; le pagine dettaglio includono testo, metadati, JSON-LD e link interni.
- Gli URL pubblici legacy senza prefisso lingua (`/logbook`, `/voyages`, `/manifesto`, ecc.) vengono reindirizzati a `/it/*` o `/en/*` già in middleware, prima del prerender, per evitare duplicati indicizzabili.
- Header `X-Robots-Tag: noindex` su `/admin*`, `/login`, `/signup`, `/bookings`, `/profile`, `/newsletter/confirm` (in `vercel.json`).

## Collegamenti
- [[05 - Frontend - Pagine]] · [[18 - Deploy e Configurazione]] · [[15 - Semantic Layer (AI Agents)]]
