---
tags: [frontend, componenti, ui]
---
# 06 - Frontend - Componenti

⬅️ [[Home]] · sorgente: `src/components/`

## Componenti di layout & navigazione
- `Layout.tsx` — shell dell'app (header + footer + main)
- `Navbar.tsx`, `NavLink.tsx`, `Footer.tsx`
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
- `ProfileCard.tsx`, `ProfileAvatar.tsx`, `ProfileNotificationsMenu.tsx`
- `ShareButton.tsx`, `AppleShareIcon.tsx`, `SeaPeopleIcon.tsx`

## SEO
- `SeoManager.tsx` — meta/OG/canonical
- `StructuredData.tsx` — JSON-LD

## Mappe
- `LazyVoyageMap.tsx`, `MapLoadingPlaceholder.tsx` → [[14 - Mappe e Layer Geospaziale]]
- `admin/AdminVoyageManager.tsx` — editor rotte admin con workspace mappa MapLibre; il comando `Fullscreen` usa la Fullscreen API del browser e mantiene un fallback layout `fixed` se l'API non è disponibile.
- `voyage/BookingSidebarPanel.tsx` — modalità booking dentro la sidebar della mappa: lista tutte le tratte prenotabili/non disponibili, pax, note e CTA, riusando la shell della sidebar articoli; la selezione illumina la tratta su `VoyageMap` e `VoyageLegend` → [[13 - Booking Voyage]]
- `voyage/VoyageLegend.tsx` — legenda rotta del logbook; mostra distanze, tappe e articoli collegati, ma non i badge di complessità delle tratte prenotabili.
- `voyage/ArticleListCard.tsx` — card articolo della sidebar `/logbook`, con thumbnail, metadati, autori, contatori e badge circolare per gli articoli già letti.

## Sottocartelle tematiche
- `ui/` — **shadcn/ui** primitives (button, dialog, input, select, tabs, toast…). Base di tutta l'interfaccia.
- `admin/` — gestione contenuti: `AdminEditorialPlan*`, `AdminNewsletterManager`, `AdminRouteManager`, `AdminVoyageManager`, `AdminMapPresenceManager`, `AdminBadgeManager`, `ArticleMiniMapEditor`, filtri collassabili… → [[16 - Admin]]
- `booking/` — flusso prenotazione e pagamento → [[13 - Booking Voyage]]
- `voyage/` — componenti dettaglio viaggio
- `home/` — sezioni della homepage
- `legal/` — blocchi pagine legali

## Collegamenti
- [[05 - Frontend - Pagine]] · [[07 - Frontend - Lib e Hooks]]
