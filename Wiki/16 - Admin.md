---
tags: [admin, cms, backoffice]
---
# 16 - Admin

⬅️ [[Home]] · sorgente: `apps/web/src/pages/Admin*`, `apps/web/src/components/admin/`

## Accesso
- Servito sul **sottodominio** `admin.biteproject.it`; rilevamento host in `apps/web/src/lib/admin-host.ts` (`isCurrentAdminHostname()`).
- Rotte protette da `AdminRoute.tsx` → [[03 - Routing e i18n]].
- Login: `/admin/login` (`AdminLogin.tsx`).
- Le rotte `/admin` e `/admin/*` usano il layout globale senza footer, così tutte le superfici backoffice restano focalizzate sull'area operativa.

## Pagine admin → [[05 - Frontend - Pagine]]
| Rotta | Pagina | Funzione |
|---|---|---|
| `/admin` | `AdminDashboard.tsx` | dashboard |
| `/admin/bookings` | `AdminVoyageBookings.tsx` | prenotazioni viaggi → [[13 - Booking Voyage]] |
| `/admin/candidates` | `AdminVoyageCandidates.tsx` | revisione candidature viaggio: profilo pubblico, info candidato, Gantt di contesto, approva/scarta o propone tratte alternative con messaggio → [[13 - Booking Voyage]] |
| `/admin/media` | `AdminMedia.tsx` | libreria media/storage |
| `/admin/mail` | `AdminMail.tsx` | casella di posta ordinaria `@biteproject.it` e automatiche `@mail.biteproject.it` → [[12 - Newsletter ed Email]] |
| `/admin/trackers` | `AdminMapPresence.tsx` | presenza su mappa → [[14 - Mappe e Layer Geospaziale]] |
| `/admin/sorgenti` | `AdminTrafficSources.tsx` | generatore di link tracciati e report della provenienza del traffico → [[26 - Sorgenti di Traffico]] |
| `/admin/article/:id` | `ArticleEditor.tsx` | editor articolo (TipTap) con anteprima full-screen |
| `/profile` | `AdminProfile.tsx` | profilo |

Sotto l'header, `/admin` monta `VoyageLiveWidget` (→ [[21 - Tracking Real-Time Viaggi]]): il widget del viaggio in corso, con i tasti "Parti ora"/"Arriva ora" per registrare le date effettive. Compare solo da 7 giorni prima della partenza prevista e fino a fine viaggio, quindi per la maggior parte dell'anno la dashboard resta invariata.

`/admin` è organizzata come workspace operativa: header compatto, CTA primaria per nuovo articolo, shortcut a Booking/Candidati/Mail/Media/Tracker/Community e KPI editoriali. Il Profilo non è duplicato tra gli shortcut principali perché resta raggiungibile dalla tendina della propic e dal dock mobile; questo mantiene la dashboard focalizzata sulle attività quotidiane. La navigazione interna raggruppa le sezioni in Contenuti, Mappa e Community, con la sezione `?section=community` per governance BITE Crew: prezzi/tier, canali/subfeed, ruoli moderator, live programmate e snapshot membership/pagamenti.

La PWA admin monta anche `AdminMobileNavigation` dal layout globale per utenti admin su `/admin/*` e `/profile`. Il dock inferiore usa safe area iOS e offre accesso persistente a Home admin, Booking, Community, Media, Mail, Tracker e Profilo; da `/profile` permette quindi di tornare a `/admin` senza passare dal menu pubblico. La dashboard sincronizza anche la Web Push subscription già autorizzata con la VAPID public key corrente, così una rotazione chiavi non richiede necessariamente il passaggio manuale da `/profile`. Il refresh token Supabase al ritorno in foreground non rilancia il caricamento dati della dashboard: le query iniziali dipendono dallo `userId` stabile, non dall'oggetto sessione, `useAuth` non riapre il gate `adminLoading` quando viene emessa una nuova sessione per lo stesso utente già verificato e `AdminRoute` non smonta la dashboard se l'utente è già admin.

## Componenti admin (`apps/web/src/components/admin/`)
- **Navigazione PWA:** `AdminMobileNavigation.tsx` è un dock mobile condiviso montato da `Layout.tsx` per route admin/profilo quando l'utente ha ruolo admin; usa link reali React Router, stato active e scroll orizzontale touch-friendly → [[06 - Frontend - Componenti]].
- **Editoriale:** `AdminEditorialPlan`, `AdminEditorialPlanSettingsDialog`, `AdminEditorialPlanSlotDialog` (piano editoriale) → `apps/web/src/lib/editorial-plan.ts`. Per il canale sito, lo slot assegnato è la fonte della schedulazione: quando un articolo viene creato o assegnato a uno slot, un trigger su `editorial_plan_slots` imposta `logbook_articles.status = scheduled` e `scheduled_at` alla data/ora dello slot nel timezone del canale; liberare lo slot deschedula solo articoli ancora non pubblicati e ancora legati a quella data. Il calendario include un cockpit social mensile calcolato solo sugli account OAuth collegati, con slot/target/reach/engagement, indicatore dei post misurabili con ID piattaforma, stato connessione per canale, insight nelle celle e una modale social per creare asset, gestire stato/caption dei target, vedere permalink/ID provider e registrare snapshot `editorial_post_insights` con metriche e note qualitative.
- **Viaggi/rotte:** `AdminVoyageManager`, `ArticleMiniMapEditor`, `AdminMapPresenceManager`. `AdminVoyageManager` è stato scomposto in pannelli presentazionali fratelli (`VoyageListPanel`, `VoyageFormPanel`, `VoyageAddressSearchPanel`, `WaypointListPanel`, oltre al preesistente `WaypointEditorPanel`), restando l'unico proprietario di stato, fetch e mutazioni → [[06 - Frontend - Componenti]]. `AdminRouteManager` è stato rimosso: non era montato da nessuna rotta ed è stato superato da [[21 - Tracking Real-Time Viaggi]]. La tabella `route_legs` che gestiva resta però in uso dalla sub-app data → [[19 - Sub-App (pack e data)]].
- **Newsletter:** `AdminNewsletterManager` → [[12 - Newsletter ed Email]]. Dal 2 agosto 2026 la logica del composer (mappe di traduzione, cosa conta come corpo, quali lingue sono obbligatorie, payload salvato, metriche di consegna) arriva da `@pynkstudio/newsletterapp/admin`: sta lì proprio perché non deve divergere dal dispatcher. Nel componente restano markup, stile e copy in italiano — il package restituisce chiavi ed esiti strutturati, non frasi.
- **Community:** `AdminCommunityManager` → [[23 - Community]] gestisce Crew Pass da `/admin?section=community`: prezzi mensili/annuali, attivazione tier, canali/subfeed con accesso per tier, ruoli moderator tramite RPC admin-only, live programmate LiveKit e snapshot membership/pagamenti. Gli admin globali sono automaticamente admin community tramite `app_role = admin`.
- **Mail:** `AdminMail.tsx` vive tra le pagine admin perché integra lista, dettaglio conversazionale, ricerca server-side e compose su API Vercel. La UI privilegia nome mittente, oggetto e preview del testo nuovo rispetto ai badge tecnici, usa l'indirizzo solo come fallback e collassa le citazioni nel corpo mail con controlli espandi/nascondi. Nel dettaglio mostra inbound e sent dello stesso `thread_key`; le risposte passano `replyToMessageId` per mantenere `In-Reply-To`/`References`. Accetta query `compose=1&to=...&subject=...` per aprire direttamente la modale di scrittura da altre superfici admin e `message=<id>` per selezionare una mail specifica, usato dai tap sulle notifiche push mail. Quando un admin legge/archivia/sposta in spam/elimina un inbound, l'API invia una revoca push che chiude le notifiche PWA pendenti della stessa mail sugli altri device admin.
- **Booking:** `BookingGanttTable.tsx` resta focalizzato sulla matrice tratte/persone ed è una superficie operativa admin: consente di aggiungere su una tratta utenti registrati oppure **Altri...** con email esterna; in questo secondo caso crea una partecipazione pending e invia il template `voyage-participant-invite`. La colonna persona mostra il solo nome cliccabile, con modale profilo e CTA mail; gli stati sono scritti per esteso sulle barre Gantt. La sezione settings di `AdminVoyageBookings.tsx` gestisce due mail briefing bilingue (`first_briefing_content_*`, `second_briefing_content_*`) con visual delle prese tipo L/F. Il drag/resize di una booking esistente genera una proposta `voyage_booking_plan_changes` con messaggio admin e notifica utente, non una modifica definitiva immediata → [[13 - Booking Voyage]]. Il drag apre `PlanChangeProposalDialog.tsx` (che ha sostituito il vecchio `window.prompt`, incapace di ospitare un select): l'admin **deve** scegliere una motivazione, e il dialog mostra la conseguenza sul rimborso prima dell'invio → [[24 - Termini e Condizioni]].
- **Candidati:** `AdminVoyageCandidates.tsx` separa la revisione qualitativa dalla matrice Gantt operativa: mostra profilo pubblico, foto, link social, risposte `candidate_info`, tratte richieste e una Gantt di contesto per vedere inserimento e compresenze. Le modifiche dalla Gantt candidato sono solo proposte pending via RPC `admin_propose_voyage_booking_legs`; approvazione, scarto e proposta possono includere un messaggio admin per l'utente. Il pannello ha un `<select>` motivazione obbligatorio accanto alla nota, con l'avvertenza sul rimborso conseguente → [[24 - Termini e Condizioni]]. Lo stesso componente (`VoyageCandidatesPanel.tsx`) ospita, quando la candidatura porta con sé una proposta di contributo alternativo/workaway, la sezione di negoziazione (accetta / contro-proponi con slider `max(€20, 50% del calcolato)` / rifiuta) e, in cima al tab **Candidature** di `/admin/bookings`, le impostazioni per-viaggio e il catalogo ruoli workaway → [[13 - Booking Voyage]].
- **Altri:** `AdminBadgeManager`, `AdminCollapsibleListFilters`, `AdminStories` (gestione storie con tipo open/closed, conteggio capitoli, collegamento/scollegamento articoli e riordinamento drag & drop via `story_sort_order`)
- Coda upload media: `apps/web/src/lib/admin-media-upload-queue.ts`

## Editor articoli
- Basato su **TipTap 3** ([[02 - Stack Tecnologico]]): heading, image, link, youtube, text-align, color, underline, placeholder, liste e tabelle. La toolbar inserisce tabelle 3×3 con intestazione; a cursore dentro una tabella permette di aggiungere righe/colonne, ridimensionare le colonne e cancellare la tabella.
- Il pulsante **Anteprima** apre una vista full-screen non persistente che costruisce l'articolo dallo stato corrente dell'editor e riusa `ArticleReader.tsx`: cover/focal point, corpo TipTap, ancore e scene mini-mappa, rotta/waypoint, media di viaggio, autori, storia e tag seguono la stessa struttura della pagina pubblica. Se il viaggio/segmento collegato ha tratti ancora selezionabili, anche la CTA **Partecipa** della minimappa è visibile; like/commenti e analytics restano disattivati.
- Sanitizzazione: `apps/web/src/lib/sanitize-rich-html.ts` (dompurify).
- Traduzione IT/EN: `translate-editor-content` ([[09 - Edge Functions]]) + `apps/web/src/lib/translate-editor-content.ts`; la function chiama OpenAI Responses API server-side con `OPENAI_API_KEY` nei secret Supabase. Gap traduzioni evidenziati da `article-translation-gaps.ts`.
- Ottimizzazione SEO IA: `optimize-article-seo` ([[09 - Edge Functions]]) genera i metadati SEO in background quando un articolo viene pubblicato o quando si applicano modifiche a un articolo già pubblicato. Se il contenuto non è cambiato rispetto all'ultimo tentativo registrato, la function salta la chiamata OpenAI; il pulsante manuale **Ottimizza SEO** per articoli pubblicati esistenti forza invece la rigenerazione. La sidebar dell'editor mostra il record SEO salvato: stato, data, meta title/description bilingue, keyword, social/alt e raccomandazioni.
- La dashboard mostra un warning **SEO IA da rivedere** per gli ultimi record `article_seo_optimizations.status = failed`, così errori non bloccanti come credito API esaurito restano visibili all'admin.
- Export Instagram story: `apps/web/src/lib/article-instagram-story.ts`.
- L'editor articoli, il profilo admin, booking admin e `AdminVoyageManager` usano `useBeforeUnloadPrompt`: mantengono il warning di uscita su desktop, ma non registrano `beforeunload` su mobile/PWA per ridurre i reload al ritorno dal background. Le navigazioni interne restano protette dai rispettivi guard e draft locali.

## SEO
Le rotte admin sono marcate `noindex, nofollow` in `vercel.json` → [[18 - Deploy e Configurazione]].

## Accesso agenti (MCP)
Le stesse capacità del backoffice sono raggiungibili da un client agentico tramite il server MCP su `/api/mcp` → [[25 - MCP Admin]]. I token si emettono e si revocano da `/profile` → **Accesso agenti** (`AdminMcpTokens.tsx`); l'agente può pianificare, scrivere bozze, programmare e preparare newsletter, ma non pubblicare né spedire: quello resta ai cron, come dalla UI.

## Collegamenti
- [[13 - Booking Voyage]] · [[12 - Newsletter ed Email]] · [[17 - Content Model]] · [[25 - MCP Admin]]
