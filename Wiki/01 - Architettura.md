---
tags: [architettura, overview]
---
# 01 - Architettura

⬅️ [[Home]]

## Visione d'insieme

BITE Project è una **SPA React** servita da Vercel, con **Supabase** come backend unico (database, autenticazione, storage, funzioni serverless). Il sito è bilingue (IT/EN) e distingue tre superfici:

1. **Sito editoriale pubblico** — logbook, racconti, viaggi, crew, manifesto, contatti.
2. **Area utente / booking** — login, profilo, prenotazione viaggi con contributo spese via [[11 - Pagamenti Bunq]].
3. **Admin** — su sottodominio dedicato `admin.biteproject.it`, gestione contenuti/newsletter/media/booking. Vedi [[16 - Admin]].

Esiste inoltre un **layer semantico/geospaziale** machine-readable (JSON, GeoJSON, `llms.txt`) pensato per crawler e agenti AI — vedi [[15 - Semantic Layer (AI Agents)]].

## Flusso richiesta (alto livello)

```
Browser ──► Vercel (SPA + edge middleware.ts) ──► index.html + bundle Vite
                                                     │
   React Router (BrowserRouter) ──► pagine lazy-loaded ([[05 - Frontend - Pagine]])
                                                     │
   @tanstack/react-query (cache persistita localStorage)
                                                     │
   Supabase JS client ──► Postgres (RLS) / Auth / Storage / Edge Functions
                                                     │
   /api/* (Vercel Functions) ──► pagamenti Bunq, sitemap, prerender
```

## Principi architetturali

- **Backend serverless-first**: nessun server applicativo dedicato; la logica sta in [[09 - Edge Functions]] (Supabase) e in [[10 - API Vercel]].
- **Amount trust server-side**: importi di pagamento e regole di sicurezza sono ricalcolati lato server, mai fidati dal client (vedi [[11 - Pagamenti Bunq]]).
- **Cache client persistente**: React Query con `PersistQueryClientProvider` su `localStorage` (chiave `bite-query-cache-v1`), solo per query marcate `meta.persist`.
- **Lazy loading** di tutte le pagine per ridurre il bundle iniziale.
- **Separazione host**: il codice riconosce il sottodominio admin (`isCurrentAdminHostname()` in `apps/web/src/lib/admin-host.ts`) e reindirizza di conseguenza.
- **Monorepo leggero**: la web app principale + sotto-app `apps/pack` e `apps/data` — vedi [[19 - Sub-App (pack e data)]].

## Collegamenti
- Stack completo: [[02 - Stack Tecnologico]]
- Come sono organizzate le cartelle: [[04 - Struttura Repository]]
- Deploy e ambiente: [[18 - Deploy e Configurazione]]
