---
tags: [frontend, componenti, ui]
---
# 06 - Frontend - Componenti

⬅️ [[Home]] · sorgente: `apps/web/src/components/`

## Componenti di layout & navigazione
- `Layout.tsx` — shell dell'app (header + footer + main)
- `Navbar.tsx`, `NavLink.tsx`, `Footer.tsx`
- `admin/AdminMobileNavigation.tsx` — dock mobile della PWA admin, visibile agli admin su `/admin/*` e `/profile`, con shortcut persistenti a Home admin, booking, candidati, media, mail, tracker e profilo → [[16 - Admin]]
- `AppErrorBoundary.tsx` — error boundary globale
- `AdminRoute.tsx` — guard rotte admin → [[16 - Admin]]
- `LegacyLangRedirect.tsx` — redirect URL legacy → [[03 - Routing e i18n]]

## Contenuto editoriale
- `ArticleSidebar.tsx`, `ArticleRelatedSection.tsx`
- `ArticleMapAside.tsx` / `LazyArticleMapAside.tsx` — mappa laterale articolo → [[14 - Mappe e Layer Geospaziale]]
- `ArticleVoyageMediaWidget.tsx`
- `CommentSection.tsx`, `LikeButton.tsx`, `LiveReadCounter.tsx` — engagement
- `AuthorSelector.tsx`

## Profilo / social
- `ProfileCard.tsx`, `ProfileAvatar.tsx`, `ProfileNotificationsMenu.tsx` — il menu notifiche mostra solo le notifiche engagement non lette; al click imposta `read_at` e rimuove subito la riga dalla lista → [[12 - Newsletter ed Email]]
- `ShareButton.tsx`, `AppleShareIcon.tsx`, `SeaPeopleIcon.tsx`

## SEO
- `SeoManager.tsx` — meta/OG/canonical
- `StructuredData.tsx` — JSON-LD

## Mappe
- `LazyVoyageMap.tsx`, `MapLoadingPlaceholder.tsx` → [[14 - Mappe e Layer Geospaziale]]
- `admin/AdminVoyageManager.tsx` — editor rotte admin con workspace mappa MapLibre; il comando `Fullscreen` usa la Fullscreen API del browser e mantiene un fallback layout `fixed` se l'API non è disponibile. La cancellazione waypoint usa una conferma inline dentro il workspace, così non interrompe il fullscreen nativo e non forza il teardown della mappa.
- `voyage/BookingSidebarPanel.tsx` — modalità booking dentro la sidebar della mappa: lista tutte le tratte prenotabili/non disponibili, riepilogo tratte/contributo spese vive, passaggio "Dicci di te" con copy esplicito di candidatura soggetta ad approvazione e CTA "Invia candidatura", riusando la shell della sidebar articoli; la selezione illumina la tratta su `VoyageMap` e `VoyageLegend` → [[13 - Booking Voyage]]
- `voyage/VoyageLiveWidget.tsx` — widget viaggio in corso: mostra la prima tratta da chiudere con i tasti "Parti ora"/"Arriva ora" e il chevron per data/ora manuale. Compare da 7 giorni prima della partenza prevista fino a fine viaggio. Prop `readOnly` per la versione viaggiatore su `/bookings`, prop `voyageIds` per limitarlo ai viaggi prenotati → [[21 - Tracking Real-Time Viaggi]]
- `voyage/VoyageLegend.tsx` — legenda rotta del logbook; mostra distanze, tappe e articoli collegati, ma non i badge di complessità delle tratte prenotabili.
- `voyage/ArticleListCard.tsx` — card articolo della sidebar `/logbook`, con thumbnail, metadati, autori, contatori e icona occhiali senza box per gli articoli già letti.

## Sottocartelle tematiche
- `ui/` — **shadcn/ui** primitives (button, dialog, input, select, tabs, toast…). Base di tutta l'interfaccia.
- `admin/` — gestione contenuti: `AdminEditorialPlan*`, `AdminNewsletterManager`, `AdminVoyageManager`, `AdminMapPresenceManager`, `AdminBadgeManager`, `ArticleMiniMapEditor`, filtri collassabili… `AdminEditorialPlan` mostra il cockpit social del mese, mentre `AdminEditorialPlanSlotDialog` gestisce asset/target/caption/stato e snapshot insight dei post. `BookingGanttTable.tsx` usa dialog in portal per aggiunta persone e dettagli profilo, evitando popover tagliati dentro la matrice → [[16 - Admin]]
- `booking/` — flusso candidatura, condizioni, prenotazione e pagamento; include `CandidateInfoForm.tsx` per raccogliere esperienza nautica, lingue, lavoro remoto, regimi alimentari, motivazione e note → [[13 - Booking Voyage]]
- `voyage/` — componenti dettaglio viaggio
- `home/` — sezioni della homepage
- `legal/` — blocchi pagine legali

## Collegamenti
- [[05 - Frontend - Pagine]] · [[07 - Frontend - Lib e Hooks]]
