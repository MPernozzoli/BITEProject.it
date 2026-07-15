---
tags: [frontend, lib, hooks, logica]
---
# 07 - Frontend - Lib e Hooks

⬅️ [[Home]] · sorgente: `apps/web/src/lib/`, `apps/web/src/hooks/`, `apps/web/src/integrations/`

## Hooks (`apps/web/src/hooks/`)
- `useAuth.tsx` — `AuthProvider` + accesso sessione Supabase → [[08 - Supabase]]
- `useArticleReads.tsx` — conteggio letture articolo (live)
- `useBeforeUnloadPrompt.ts` — prompt nativo per modifiche non salvate: attivo su desktop, disattivato su mobile/PWA per non interferire col ripristino pagina dopo background.
- `usePublicContentSnapshot.ts` — snapshot contenuti pubblici in cache
- `use-mobile.tsx` — breakpoint mobile
- `use-toast.ts` — API toast (shadcn)

## Integrazioni (`apps/web/src/integrations/`)
- `supabase/client.ts` — istanza client Supabase (URL/key da env)
- `supabase/types.ts` — **tipi generati** dallo schema DB

## Lib per dominio (`apps/web/src/lib/`)

### Auth & sessione
- `supabase-auth.ts`, `supabase-auth-storage.ts`, `admin-host.ts`, `visitor-key.ts`
- Le sessioni effimere continuano a essere pulite su chiusura/reload desktop; su mobile/PWA il cleanup non registra `beforeunload` per evitare ricariche o perdita di stato quando la pagina viene sospesa.

### Articoli / contenuto editoriale
- `article-content.ts`, `article-cover.ts`, `article-media.tsx`, `article-slug.ts`
- `article-map.ts`, `article-map-anchor.ts` — geo articolo → [[14 - Mappe e Layer Geospaziale]]
- `article-instagram-story.ts` — export story IG
- `article-translation-gaps.ts`, `route-waypoint-translation-gaps.ts` — gap traduzioni IT/EN
- `content-images.ts`, `sanitize-rich-html.ts`, `editorial-plan.ts`, `public-content.ts`

### Booking & pagamenti → [[13 - Booking Voyage]] / [[11 - Pagamenti Bunq]]
- `booking-deposit.ts` — **calcolo contributo server-authoritative**
- `booking-candidate-info.ts` — tipo, opzioni, livelli lingua, normalizzazione e prefill riusabile per le risposte candidato (`candidate_info`)
- `booking-briefings.ts` — testi default bilingue e risoluzione fallback per prima/seconda mail briefing viaggio.
- `booking-payment.ts`, `booking-participants.ts`, `booking-utils.ts`
- `danger-reasons.ts` — modificatori navigazione pericolosa
- `voyage-schedule.ts` — regole di fase viaggio/tratta (`getLegPhase`, `getVoyagePhase`, `isLegBookableNow`, `getPendingActual`, `isLegDelayed`, `shouldShowLiveWidget`). Mirror TS delle funzioni SQL omonime: vanno cambiati insieme → [[21 - Tracking Real-Time Viaggi]]
- `voyage-utils.ts` — util rotte/waypoint, reverse geocoding e naming tappe; per waypoint marittimi evita label generiche di stato/paese, usa solo la città se il marker sembra una fermata costiera/portuale e altrimenti preferisce toponimi marittimi reali (baie, cale/località, capi, isole). L'admin può forzare il naming città o baia/cala dall'inspector WPT.

### Mappe → [[14 - Mappe e Layer Geospaziale]]
- `maplibre.ts`, `map-presence.ts`

### Newsletter / notifiche → [[12 - Newsletter ed Email]]
- `newsletter.ts`, `email-notification-preferences.ts`
- `mail-display.ts` — helper UI mail riusabili per nome mittente (`from_name` → firma → indirizzo), preview del solo testo nuovo e split delle citazioni; da sostituire con API `@pynkstudio/mailapp` quando il package le esporrà.

### Profilo
- `profile-avatar.ts`, `profile-completeness.ts`

### SEO / i18n / infra
- `seo.ts`, `i18n.tsx`, `language.ts` — traduzioni, tipi lingua condivisi e rilevamento lingua → [[03 - Routing e i18n]]
- `pwa.ts` — service worker/PWA; viene registrato dopo il mount React per non bloccare il primo render.
- `boot-splash-3d.ts` — splash 3D con three.js mantenuta nel codice ma non più collegata al bootstrap/route iniziale.
- `hero-ready-event.ts` — evento legacy per readiness hero, non più usato per trattenere il caricamento della home.
- `utils.ts`, `translate-editor-content.ts`
- `admin-media-upload-queue.ts` — coda upload media admin

## Server helper (`apps/web/src/server/`)
Usati dalle [[10 - API Vercel]]:
- `http.ts` — util richieste
- `bunq/` — `client.ts`, `payment-requests.ts`, `deposit-resolver.ts`, `bank-details.ts`, `supabase.ts` → [[11 - Pagamenti Bunq]]

## Collegamenti
- [[06 - Frontend - Componenti]] · [[08 - Supabase]]
