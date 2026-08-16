---
tags: [frontend, lib, hooks, logica]
---
# 07 - Frontend - Lib e Hooks

⬅️ [[Home]] · sorgente: `apps/web/src/lib/`, `apps/web/src/hooks/`, `apps/web/src/integrations/`

## Hooks (`apps/web/src/hooks/`)
- `useAuth.tsx` — `AuthProvider` + accesso sessione Supabase → [[08 - Supabase]]
- `useArticleReads.tsx` — conteggio letture articolo (live); quando un utente autenticato registra la lettura di un articolo, archivia anche le notifiche in-app di pubblicazione (`notification_category = publication`) relative a quell'articolo impostando `read_at` → [[12 - Newsletter ed Email]]
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
- `booking-application-draft.ts` — serializzazione bozza candidatura: `localStorage` per utenti anonimi e sincronizzazione Supabase su `voyage_booking_drafts` per utenti loggati.
- `booking-briefings.ts` — testi default bilingue e risoluzione fallback per prima/seconda mail briefing viaggio.
- `booking-payment.ts`, `booking-participants.ts`, `booking-utils.ts` — helper booking e soste waypoint condivisi tra `/admin/bookings` e gestione rotte.
- `booking-planning.ts` — helper **puri** di pianificazione rotta admin: formattazione date/finestre/durate/distanze e matematica arrivo → sosta → ripartenza (`getWaypointArrivalDate`, `getStopHoursFromArrivalAndDepartureTime`, `isDepartureTimeAfterArrival`, `toDateTimeLocalValue`…). Vivevano come funzioni module-private dentro `pages/AdminVoyageBookings.tsx`; sono state estratte quando i pannelli in `components/admin/` hanno iniziato a servirsene, perché **un componente non deve importare da una pagina**. Nessuna dipendenza da stato React: input → output, quindi testabili in isolamento → [[06 - Frontend - Componenti]]
- `booking-refunds.ts` — client di `POST /api/bookings/status` per le transizioni terminali con rimborso; accetta `refundPercentOverride` (può solo alzare la percentuale di policy).
- `plan-change-reasons.ts` — catalogo motivazioni delle proposte di modifica piano e mapping forza maggiore. **Solo label per la UI**: il flag `force_majeure` autoritativo è derivato server-side in SQL, i due elenchi vanno tenuti allineati → [[24 - Termini e Condizioni]]
- `danger-reasons.ts` — modificatori navigazione pericolosa
- `waypoint-form.ts` — trasformazione pura dello stato inspector WPT in patch persistibili; preserva anche l'orario di ripartenza delle soste brevi per non disallineare `/routes` da `/bookings`.
- `voyage-schedule.ts` — regole di fase viaggio/tratta (`getLegPhase`, `getVoyagePhase`, `isLegBookableNow`, `getPendingActual`, `isLegDelayed`, `shouldShowLiveWidget`). Mirror TS delle funzioni SQL omonime: vanno cambiati insieme → [[21 - Tracking Real-Time Viaggi]]
- `voyage-utils.ts` — util rotte/waypoint, reverse geocoding e naming tappe; per waypoint marittimi evita label generiche di stato/paese, usa solo la città se il marker sembra una fermata costiera/portuale e altrimenti preferisce toponimi marittimi reali (baie, cale/località, capi, isole). Il fallback visuale è `WPT NN`, non coordinate salvate come nome; vecchi nomi in formato coordinate vengono trattati come provvisori e possono essere sovrascritti dal naming automatico. L'admin può forzare il naming città o baia/cala dall'inspector WPT. Espone anche `getWaypointOptionLabel` (etichetta dei `<select>` admin: `Start`, `WP 03 · Nome`, `Arrival`), spostata qui dall'editor articoli quando il pannello di associazione geo ha iniziato a servirsene → [[06 - Frontend - Componenti]]

### Mappe → [[14 - Mappe e Layer Geospaziale]]
- `maplibre.ts`, `map-presence.ts`

### Newsletter / notifiche → [[12 - Newsletter ed Email]]
- `newsletter-config.ts` — config BITE isomorfa per `@pynkstudio/newsletterapp` (dominio, mittente, lingue). Vive in `lib/` e non in `server/newsletter.ts` perché la usa anche la console admin, e quel modulo tira dentro `web-push` e il client service-role.
- `newsletter.ts` — **dal 2 agosto 2026 è un adattatore**: merge tag, anteprima del composer e tolleranza alle tabelle non ancora migrate arrivano dal package; qui restano solo le etichette in italiano.
- `email-notification-preferences.ts`
- ~~`mail-display.ts`~~ — **rimosso il 28 luglio 2026**: gli helper per nome mittente (`from_name` → firma → indirizzo), preview del solo testo nuovo e split delle citazioni sono ora in `@pynkstudio/mailapp/mailbox` (isomorfo, safe nel bundle client). `AdminMail.tsx` importa da lì → [[12 - Newsletter ed Email]].

### Profilo
- `profile-copy.ts` — `PROFILE_COPY`, il copy IT/EN completo di `/profile` (~300 righe), estratto dalla pagina perché i pannelli in `components/admin/` ne consumano il tipo. Esporta `ProfileCopy` come **unione IT|EN**, non `PROFILE_COPY["it"]`: con `as const` i due rami hanno literal type diversi e restringere all'italiano rifiuterebbe il ramo inglese → [[06 - Frontend - Componenti]]
- `profile-avatar.ts`, `profile-completeness.ts`

### SEO / i18n / infra
- `seo.ts`, `i18n.tsx`, `language.ts` — traduzioni, tipi lingua condivisi e rilevamento lingua → [[03 - Routing e i18n]]. `ArticlePage.tsx` preferisce `article_seo_optimizations` quando il record è `ready`, poi ricade sugli excerpt editoriali; `ArticleEditor.tsx` mostra lo stesso record in sidebar per controllo editoriale e retry manuale.
- `pwa.ts` — service worker/PWA; viene registrato dopo il mount React per non bloccare il primo render.
- `boot-splash-3d.ts` — splash 3D con three.js mantenuta nel codice ma non più collegata al bootstrap/route iniziale.
- `hero-ready-event.ts` — evento legacy per readiness hero, non più usato per trattenere il caricamento della home.
- `utils.ts`, `translate-editor-content.ts`
- `admin-media-upload-queue.ts` — coda upload media admin

## Server helper (`apps/web/src/server/`)
Usati dalle [[10 - API Vercel]]:
- `http.ts` — util richieste
- `bunq/` — `client.ts`, `payment-requests.ts`, `deposit-resolver.ts`, `bank-details.ts`, `supabase.ts` → [[11 - Pagamenti Bunq]]

## Sub-app BITE Crew → [[23 - Community]]
Sorgente: `apps/crew/src/lib/`, `apps/crew/src/integrations/`.

- `community.ts` — tipi e helper per tier, subscription, pagamenti, benefit, post, live event, poll, slug, date, valuta, label benefit e normalizzazione `linked_resources` community.
- `auth-redirect.ts` — costruzione del redirect verso `login.biteproject.it` mantenendo `redirect` di ritorno alla sub-app.
- `supabase-auth-storage.ts` — stessa logica cookie/localStorage condivisa della main app per sessione cross-subdomain.
- `supabase-auth.ts` — helper sessione locale della sub-app.
- `article-media.tsx` / `article-map-anchor.ts` — copie isolate delle estensioni TipTap usate dall'editor post.
- `integrations/supabase/client.ts` — client Supabase della crew app con auth condivisa e passkey abilitate.

## Collegamenti
- [[06 - Frontend - Componenti]] · [[08 - Supabase]]
