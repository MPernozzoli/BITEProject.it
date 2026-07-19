---
tags: [frontend, pagine, routing]
---
# 05 - Frontend - Pagine

⬅️ [[Home]] · sorgente: `apps/web/src/pages/` · routing: [[03 - Routing e i18n]]

Tutte le pagine sono **lazy-loaded** in `apps/web/src/App.tsx`.

## Sito editoriale pubblico
| Pagina | Rotta | Descrizione |
|---|---|---|
| `Index.tsx` | `/it` `/en` | Home / landing |
| `About.tsx` | `crew` | "The Crew" — presentazione equipaggio |
| `Manifesto.tsx` | `manifesto` | Manifesto del progetto |
| `Journal.tsx` | `logbook` | Indice logbook/articoli |
| `ArticlePage.tsx` | `logbook/:slug` | Articolo singolo (con mappa, related) |
| `StoryPage.tsx` | `logbook/story/:slug` | Racconto/story |
| `Voyages.tsx` | `voyages` | Elenco viaggi |
| `VoyagePage.tsx` | `voyages/:voyageRef` | Dettaglio viaggio + mappa rotta |
| `Collaborations.tsx` | `collaborations` | Collaborazioni aperte: ricerca in mare, creator/editoriale e brand |
| `Contact.tsx` | `contact` | Form contatti → [[09 - Edge Functions\|contact-form-submit]] |
| `Links.tsx` | `links` | Pagina linktree |
| `NotFound.tsx` | `*` | 404 |

SEO statico: `SeoManager.tsx` assegna a `/crew` title/description e JSON-LD orientati a ciurma, Spritz e **Deerberg Beryll 32**; `/collaborations` usa title/description e JSON-LD mirati a collaborazioni con ricercatori, citizen science, creator project, progetti editoriali, brand partnership e documentazione da uso reale in mare.

`Collaborations.tsx` posiziona la pagina come invito ampio: BITE è una barca/logbook/piattaforma sul campo. La sezione non è più una lista stringente di categorie prodotto, ma distingue ricerca sul campo in mare, progetti editoriali/creator e brand/servizi, con aree aperte che includono biologia marina, open data, cultura/outdoor, vita a bordo, connettività, animali e sostenibilità.

`About.tsx` usa `crew-hero-godot.webp` come immagine hero locale della pagina crew, con overlay scuro per mantenere leggibili titolo e intro.

## Area utente / booking → [[13 - Booking Voyage]]
| Pagina | Rotta |
|---|---|
| `UserLogin.tsx` | `/login`, `/signup` |
| `CompleteProfile.tsx` | `/complete-profile` |
| `PublicProfile.tsx` | `/profile/:id` |
| `UserBookings.tsx` | `/bookings` |
| `ManageBookingParticipants.tsx` | `/bookings/:id/participants` |

`UserLogin.tsx` usa un layout passwordless con azioni Google, passkey ed email OTP, autocomplete `username` sull'email e stato "ultimo usato" mostrato sulle azioni effettive; il riepilogo visuale dei metodi non viene più renderizzato. `/admin/login` continua a rimandare allo stesso flusso unificato, ma il router lo forza sul dominio principale per evitare errori WebAuthn sull'origin admin.

`UserBookings.tsx` è compilabile anche senza sessione quando l'utente arriva da un viaggio (`/bookings?voyage=...`): salva una bozza candidatura in `localStorage`, manda al login solo al momento dell'invio e poi riprende lo stesso URL. Da loggato sincronizza la bozza anche su Supabase (`voyage_booking_drafts`). Mostra inoltre, per booking confermati, la sezione **Mail briefing** divisa in primo briefing e secondo briefing operativo; la seconda scheda include anche la visualizzazione delle prese tipo L/F presenti a bordo.

## Newsletter / legali → [[12 - Newsletter ed Email]]
| Pagina | Rotta | Note |
|---|---|---|
| `NewsletterConfirm.tsx` | `/newsletter/confirm` | conferma iscrizione newsletter |
| `Unsubscribe.tsx` | `/unsubscribe` | gestione disiscrizione/preferenze email |
| `PrivacyPolicy.tsx` | `/privacy-policy` | informativa aggiornata per community, newsletter, contact form, partecipazione viaggi, inviti partecipanti, contributi spese, Bunq/bonifico e Web Push |
| `CookiePolicy.tsx` | `/cookie-policy` | cookie/local storage tecnici per lingua, sessione, community, booking, pagamenti, UI e notifiche push |

## Admin → [[16 - Admin]]
| Pagina | Rotta |
|---|---|
| `AdminLogin.tsx` | `/admin/login` |
| `AdminDashboard.tsx` | `/admin` |
| `AdminVoyageBookings.tsx` | `/admin/bookings` |
| `AdminVoyageCandidates.tsx` | `/admin/candidates` |
| `AdminMedia.tsx` | `/admin/media` |
| `AdminMail.tsx` | `/admin/mail` |
| `AdminMapPresence.tsx` | `/admin/trackers` |
| `ArticleEditor.tsx` | `/admin/article/:id` |
| `AdminProfile.tsx` | `/profile` |

`ArticlePage.tsx` resta responsabile di query, SEO, redirect slug e conteggi lettura, ma delega il rendering visivo a `ArticleReader.tsx`. `ArticleEditor.tsx` usa lo stesso reader per il pulsante **Anteprima**, alimentandolo con lo stato corrente non salvato dell'editor.

`AdminMail.tsx` mantiene la lista messaggi pulita senza badge dominio/routing, con header compatto e ricerca per mittente/destinatario/corpo/data. Mostra il nome mittente quando disponibile o inferibile dalla firma e usa l'indirizzo solo come fallback. L'anteprima usa solo il testo nuovo prima del thread citato; nel corpo le citazioni restano collassabili con azioni "Mostra di più da..." / "Nascondi", mentre gli URL in testo semplice diventano link cliccabili. Il layout di lettura usa una colonna messaggio centrata con larghezza tipografica controllata, header dettaglio sticky, wrapping robusto per URL lunghi e altezze scroll separate tra lista e dettaglio su desktop. Su mobile la pagina usa un drill-down: elenco e dettaglio non si impilano, `?message=` apre una vista mail dedicata con toolbar superiore per tornare all'elenco, rispondere, rispondere a tutti, preferire e archiviare. Gli allegati inbound sono mostrati come card con preview immagine quando l'URL firmato Resend è fresco e download rigenerato via API quando serve; la modale compose accetta allegati da file picker e drag&drop desktop.

`AdminVoyageBookings.tsx` nella sezione settings gestisce i contenuti bilingue delle due mail briefing viaggio (`first_briefing_content_*`, `second_briefing_content_*`) oltre a prepartenza, note operative e checklist.

`AdminVoyageManager.tsx` nella gestione rotte salva e ricarica anche la configurazione soste dei waypoint (`stop_mode`, ore/giorni, orario ripartenza e durata legacy). Il calcolatore date usa la velocita di planning del voyage e fa partire la tratta successiva dopo la sosta effettiva, allineandosi con `/admin/bookings`.

Su iPhone/PWA, `Layout.tsx` aggiunge un dock mobile admin persistente su `/admin/*` e `/profile` per utenti con ruolo admin. Le pagine secondarie e il profilo hanno quindi sempre un link diretto alla Home admin (`/admin`) e alle altre aree operative.

`AdminDashboard.tsx` usa una gerarchia da workspace: CTA primaria per nuovo articolo, shortcut solo per aree operative frequenti, KPI editoriali e navigazione interna per gruppi Contenuti/Operazioni/Audience. Il Profilo resta fuori dagli shortcut principali perché già coperto dalla propic e dal dock mobile.

Nel tab Piano editoriale, `AdminDashboard.tsx` monta `AdminEditorialPlan`: calendario multicanale con cockpit social mensile, target social gestibili e raccolta insight sui post tramite `editorial_post_insights` → [[16 - Admin]].

## Sub-app BITE Crew → [[23 - Community]]
Sorgente: `apps/crew/src/pages/`. Router separato dalla main app, servito su `/Crew/` e `crew.biteproject.it`.

| Pagina | Rotta | Descrizione |
|---|---|---|
| `CrewHome.tsx` | `/` | feed community, tier Crew Pass, stato subscription e CTA Bunq |
| `CrewPostPage.tsx` | `/post/:slug` | dettaglio post con contenuto TipTap e discussione |
| `CrewLivePage.tsx` | `/live` | live thread realtime per navigazioni, Q&A e aggiornamenti guidati; creazione eventi admin |
| `CrewPollsPage.tsx` | `/polls` | poll member-only con risultati aggregati e form admin |
| `CrewAccountPage.tsx` | `/account` | stato Crew Pass, benefit, pagamenti e cambio tier |
| `CrewEditor.tsx` | `/studio`, `/studio/:id` | studio admin isolato per creare/modificare post BITE Crew |

## Collegamenti
- Componenti usati: [[06 - Frontend - Componenti]]
- Logica condivisa: [[07 - Frontend - Lib e Hooks]]
