---
tags: [frontend, componenti, ui]
---
# 06 - Frontend - Componenti

⬅️ [[Home]] · sorgente: `apps/web/src/components/`

## Componenti di layout & navigazione
- `Layout.tsx` — shell dell'app (header + footer + main); non monta il footer sulle rotte `/admin` e `/admin/*`
- `Navbar.tsx`, `NavLink.tsx`, `Footer.tsx`
- `admin/AdminMobileNavigation.tsx` — dock mobile della PWA admin, visibile agli admin su `/admin/*` e `/profile`, con shortcut persistenti a Home admin, booking, community, media, mail, tracker e profilo → [[16 - Admin]]
- `AppErrorBoundary.tsx` — error boundary globale
- `AdminRoute.tsx` — guard rotte admin → [[16 - Admin]]
- `LegacyLangRedirect.tsx` — redirect URL legacy → [[03 - Routing e i18n]]

## Contenuto editoriale
- `ArticleSidebar.tsx`, `ArticleRelatedSection.tsx`
- `ArticleMapAside.tsx` / `LazyArticleMapAside.tsx` — mappa laterale articolo → [[14 - Mappe e Layer Geospaziale]]
- `ArticleVoyageMediaWidget.tsx`
- `CommentSection.tsx`, `LikeButton.tsx`, `LiveReadCounter.tsx` — engagement
- `ArticleReader.tsx` — renderer condiviso della pagina articolo: cover, metadati/autori, contenuto TipTap sanificato, scene mappa, media di viaggio, tag, engagement e sidebar. `ArticlePage.tsx` lo usa con side effect pubblici attivi; `ArticleEditor.tsx` lo usa per anteprima admin senza like/commenti/analytics.
- `AuthorSelector.tsx`

## Profilo / social
- `ProfileCard.tsx`, `ProfileAvatar.tsx`, `ProfileNotificationsMenu.tsx` — il menu notifiche mostra solo le notifiche engagement non lette; al click imposta `read_at` e rimuove subito la riga dalla lista → [[12 - Newsletter ed Email]]
- `profile/ProfileCrewPassPanel.tsx` — pannello membership dentro `/profile`: stato Crew Pass, rinnovo manuale Bunq, tier disponibili e pagamenti recenti → [[23 - Community]]
- `ShareButton.tsx`, `AppleShareIcon.tsx`, `SeaPeopleIcon.tsx`

## SEO
- `SeoManager.tsx` — meta/OG/canonical
- `StructuredData.tsx` — JSON-LD

## Mappe
- `LazyVoyageMap.tsx`, `MapLoadingPlaceholder.tsx` → [[14 - Mappe e Layer Geospaziale]]
- `admin/AdminVoyageManager.tsx` — editor rotte admin con workspace mappa MapLibre; il comando `Fullscreen` usa la Fullscreen API del browser e mantiene un fallback layout `fixed` se l'API non è disponibile. L'inspector waypoint resta aperto finché non si usa `Collassa`: senza WPT selezionato mostra un invito a selezionare un punto e la stessa lista waypoint della vista sotto-mappa. Le bozze waypoint non salvate persistono in `localStorage` e vengono ripristinate dopo cambio pagina o reload; il warning `beforeunload` resta solo per il form anagrafica rotta. La cancellazione waypoint usa una conferma inline dentro il workspace e i controlli tipo/naming/sosta del WPT usano bottoni segmentati invece di picker nativi, così non interrompono il fullscreen e non forzano il teardown della mappa. Il file resta proprietario di stato, fetch e mutazioni, ma la UI è scomposta in pannelli presentazionali fratelli (sotto); `WaypointEditorPanel.tsx` era già estratto in precedenza.
  - `admin/VoyageListPanel.tsx` — filtri (base/avanzati, collassabili), ordinamento e lista viaggi selezionabili/modificabili.
  - `admin/VoyageFormPanel.tsx` — form anagrafica viaggio (nome/slug, date, stato, testi bilingui, contributo spese vive), con switch lingua interno IT/EN del form. La card "Rigenera geometria" resta nel padre: è salvataggio rotta, non anagrafica.
  - `admin/VoyageAddressSearchPanel.tsx` — ricerca indirizzi/POI dei viaggi land-only, con focus mappa e aggiunta diretta del risultato come waypoint.
  - `admin/WaypointListPanel.tsx` — lista waypoint con drag&drop, riordino, rename inline, toggle visibilità e focus mappa. Riceve `eventLabels` già calcolate dal padre (`useMemo`) invece di importare helper module-privati.
  - Pattern comune di questi pannelli, identico a quello di `AdminVoyageBookings.tsx`: **cartella piatta, nessun barrel file**, `export default` + `export interface <Nome>Props`, componenti **puramente presentazionali** (zero chiamate Supabase), tipi condivisi importati come `import type { … } from "@/components/admin/AdminVoyageManager"`.
  - La lingua UI viene letta dentro la mappa via `langRef` (ref sincronizzata da `useEffect`), non direttamente da `lang`: leggerla direttamente metteva `lang` nel dependency array dell'effect di bootstrap MapLibre, e cambiare lingua IT/EN distruggeva e ricreava l'intera istanza mappa resettando camera e zoom.
- `voyage/BookingSidebarPanel.tsx` — modalità booking dentro la sidebar della mappa: lista tutte le tratte prenotabili/non disponibili, riepilogo tratte/contributo spese vive, passaggio "Dicci di te" con copy esplicito di candidatura soggetta ad approvazione e CTA "Invia candidatura", riusando la shell della sidebar articoli; la selezione illumina la tratta su `VoyageMap` e `VoyageLegend` → [[13 - Booking Voyage]]
- `voyage/VoyageLiveWidget.tsx` — widget viaggio in corso: mostra la prima tratta da chiudere con i tasti "Parti ora"/"Arriva ora" e il chevron per data/ora manuale. Compare da 7 giorni prima della partenza prevista fino a fine viaggio. Prop `readOnly` per la versione viaggiatore su `/bookings`, prop `voyageIds` per limitarlo ai viaggi prenotati → [[21 - Tracking Real-Time Viaggi]]
- `voyage/VoyageLegend.tsx` — legenda rotta del logbook; mostra distanze, tappe e articoli collegati, ma non i badge di complessità delle tratte prenotabili.
- `voyage/ArticleListCard.tsx` — card articolo della sidebar `/logbook`, con thumbnail, metadati, autori, contatori e icona occhiali senza box per gli articoli già letti.

## Sottocartelle tematiche
- `ui/` — **shadcn/ui** primitives (button, dialog, input, select, tabs, toast…). Base di tutta l'interfaccia.
- `admin/` — gestione contenuti: `AdminEditorialPlan*`, `AdminCommunityManager`, `AdminNewsletterManager`, `AdminVoyageManager`, `AdminMapPresenceManager`, `AdminBadgeManager`, `ArticleMiniMapEditor`, filtri collassabili… `AdminCommunityManager` governa Crew Pass, prezzi, canali/subfeed, ruoli moderator, live modificabili (titolo, date, accesso, tier, modalità, archiviazione) e snapshot pagamenti; `AdminEditorialPlan` mostra il cockpit social del mese, mentre `AdminEditorialPlanSlotDialog` gestisce asset/target/caption/stato e snapshot insight dei post. `BookingGanttTable.tsx` usa dialog in portal per aggiunta persone e dettagli profilo, evitando popover tagliati dentro la matrice → [[16 - Admin]]. `AdminMcpTokens.tsx` (montato da `AdminProfile` su `/profile` per gli admin) emette e revoca i token del server MCP: il valore in chiaro è mostrato una volta sola perché non è recuperabile → [[25 - MCP Admin]]
- `booking/` — flusso candidatura, condizioni, prenotazione e pagamento; include `CandidateInfoForm.tsx` per raccogliere esperienza nautica, lingue, lavoro remoto, regimi alimentari, motivazione e note, e `BookingPartyPanel.tsx` che mostra a ogni membro di una prenotazione di gruppo gli altri partecipanti con la propria quota e il relativo stato, aggiungendo per chi ha prenotato le azioni sulle quote non versate → [[13 - Booking Voyage]]

### Pannelli di `AdminVoyageBookings.tsx`
La pagina ([[05 - Frontend - Pagine]]) è organizzata in 5 tab e ognuno è un pannello presentazionale fratello, stesso pattern dei pannelli di `AdminVoyageManager` (cartella piatta, `export default` + `export interface <Nome>Props`, zero chiamate Supabase, la pagina resta l'unica proprietaria di stato/fetch/mutazioni):
- `admin/VoyageStopsPanel.tsx` — tab **Soste**: per ogni waypoint narrativo arrivo/sosta/ripartenza, preset ore/notti, orario di ripartenza e coerenza con la tratta in ingresso.
- `admin/VoyageLegsPanel.tsx` — tab **Rotte**: finestre di partenza/arrivo per tratta, flag prenotabile, complessità (auto o override), livello di pericolo e relative motivazioni.
- `admin/VoyageWorkawaySettingsPanel.tsx` — tab **Candidature**, parte impostazioni: contributo alternativo/workaway per viaggio e catalogo ruoli. Convive nella stessa `<section>` con `VoyageCandidatesPanel.tsx`, che resta il pannello di revisione delle candidature.
- `admin/BookingSettingsPanel.tsx` — tab **Briefing**: prepartenza, le due mail briefing bilingui, termini/note operative e checklist.
- I tab **Overview** (lista prenotazioni + Gantt) usano `BookingGanttTable.tsx`, già estratto in precedenza.

### Pannelli di `ArticleEditor.tsx`
Stesso pattern, applicato alla sidebar e agli overlay dell'editor articoli:
- `admin/ArticleGeoAssociationPanel.tsx` — luogo dell'articolo (ricerca geo, mappa, lat/lng) e associazione al viaggio: modalità **point / segment / full** e scelta dei waypoint. La pagina resta proprietaria dell'istanza MapLibre: passa `geoMapRef`/`geoMarkerRef` e il pannello si limita a renderizzare il contenitore. I valori derivati dalle opzioni waypoint sono calcolati **dentro** il pannello, non passati come props, perché nessun altro li usa.
- `admin/ArticleSeoPanel.tsx` — stato dell'ottimizzazione SEO generata da `optimize-article-seo` ([[09 - Edge Functions]]): badge di stato, meta title/description, keyword e raccomandazioni, con rigenerazione manuale. Possiede i propri helper di parsing e **esporta il tipo `ArticleSeoOptimization`**, che la pagina importa: il tipo appartiene al pannello, non viceversa.
- `admin/ArticlePreviewOverlay.tsx` — anteprima a schermo intero con switch IT/EN, alimentata da `ArticleReader` in `previewMode` (niente like/commenti/analytics).
- `admin/ArticleEditorDialogs.tsx` — i tre dialog di conferma: scelta pubblica-ora/pianifica, uscita con modifiche non salvate, offerta di traduzione quando mancano campi nell'altra lingua → [[03 - Routing e i18n]].

### Pannelli di `AdminProfile.tsx` e `Journal.tsx`
- `admin/ProfilePreferencesPanel.tsx` — card "Preferenze" di `/profile`: lingua principale/secondaria, newsletter, notifiche email, Web Push, passkey e installazione app mobile. Il copy IT/EN vive in `lib/profile-copy.ts` → [[07 - Frontend - Lib e Hooks]].
- `JournalMapStatsBar.tsx` (in `components/`, non `admin/`: è superficie pubblica) — barra statistiche flottante della vista mappa del logbook: miglia in mare, km a terra, conteggio viaggi e selettore viaggio/tipo. Solo desktop. Possiede i due helper di classe CSS per icona e pill di stato viaggio, che erano module-private in `Journal.tsx` e servivano solo a questa barra.

> **Nota sul costo delle props.** Questi pannelli hanno superfici ampie (`ProfilePreferencesPanel` ne ha 38) perché la pagina resta l'unica proprietaria dello stato: è il prezzo di un'estrazione puramente presentazionale, scelta perché verificabile con `tsc` + build in assenza di test ([[20 - Comandi e Workflow]]). Per ridurle il passo giusto è spostare **lo stato**, non ri-accorpare la UI.
>
> **Due pagine sono state deliberatamente lasciate intere:** in `UserBookings.tsx` ogni blocco candidato richiede 22-52 props (i valori derivati da `detailsRequest` servono sia al dialog di dettaglio sia al resto della pagina), e in `Journal.tsx` la sidebar articoli ne richiede 46. Lì estrarre non migliorerebbe nulla: aggiungerebbe solo uno strato di prop-passing. Servirebbe prima ristrutturare la proprietà dello stato — un cambiamento di comportamento, non un movimento di codice.
- `voyage/` — componenti dettaglio viaggio
- `home/` — sezioni della homepage
- `legal/` — blocchi pagine legali

## Sub-app BITE Crew → [[23 - Community]]
Sorgente: `apps/crew/src/components/`.

- `CrewLayout.tsx` — shell separata della community, con navbar `BITE Crew`, link a vetrina, Feed, Live, Polls, Profilo main app, sito principale e accesso condizionale allo studio admin.
- `CrewFeedPage.tsx` — feed protetto per membri attivi: composer unico in cima per testo/link/media URL/poll/live, post più recenti in alto, sidebar canali e subfeed `/feed/:channelSlug`.
- `CommunityReferences.tsx` — picker e renderer card per referenziare contenuti dell'app principale nei post/commenti: articoli, stories, viaggi e tratte prenotabili. I riferimenti ad articoli aprono una modale interna con contenuto logbook e autori, oltre al link esterno al sito principale.
- `CommunityPostSurface.tsx` — card condivisa per superfici community: preview link esterni, foto/video/audio da URL, poll inline con risultati e voto, live con stato e CTA a `/live?event=...`.
- `ArticleThreadComments.tsx` — thread pubblico per post Crew generati da articoli: riusa `article_comments`/`comment_likes`, quindi i commenti sono gli stessi tra logbook e Crew.
- `CommunityComments.tsx` — commenti/reply/reaction realtime sui post nativi community, modellati su `CommentSection.tsx` degli articoli, con moderazione admin (`is_hidden`) e riferimenti a contenuti principali.
- `TiptapRenderer.tsx` — renderer minimale del JSON TipTap dei post community.
- `admin/RichTextEditor.tsx` e `admin/MediaFigureNodeView.tsx` — copia isolata dell'editor articoli, usata dallo studio community senza importare l'admin della main app.
- `ui/` — primitives shadcn copiate per rendere `apps/crew` autosufficiente.

## Collegamenti
- [[05 - Frontend - Pagine]] · [[07 - Frontend - Lib e Hooks]]
