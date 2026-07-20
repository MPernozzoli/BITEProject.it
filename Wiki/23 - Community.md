---
tags: [community, membership, sub-app, pagamenti, booking]
---
# 23 - Community

⬅️ [[Home]]

## Stato implementazione

Implementazione iniziale completata e isolata:

- sub-app Vite `apps/crew` (`@biteproject/crew`) servita con base `/Crew/`;
- sottodominio previsto `crew.biteproject.it`, riscritto a `/Crew` da `middleware.ts`/`apps/web/middleware.ts`;
- nessun link aggiunto alla navbar o alle rotte dell'app principale;
- `robots: noindex,nofollow` su `/Crew/*`;
- stesso account Supabase tramite storage auth condiviso su `.biteproject.it`;
- login centralizzato su `login.biteproject.it`; `/login` e `/signup` nella sub-app sono bridge verso l'host auth dedicato;
- design system importato da `apps/web/src/index.css`, come fa `apps/data`;
- editor admin `/studio` e `/studio/:id` con TipTap/RichTextEditor derivato dalla creazione articoli;
- feed `/`, dettaglio `/post/:slug`, commenti realtime e reaction;
- live thread `/live` con messaggi realtime, layout video + chat e moderazione admin;
- LiveKit predisposto per eventi video/audio/stage programmabili, con token firmati server-side da `/api/community/livekit-token`;
- reminder live "Avvisami" per utente/evento, con mail e Web Push 10 minuti prima e all'avvio;
- poll `/polls` con voting member-only, risultati aggregati e form admin;
- home `/` come vetrina per utenti anonimi/non abbonati e feed reale protetto su `/feed`;
- canali/subfeed `community_channels` con accesso opzionalmente limitato per tier;
- card complete nel feed e nel dettaglio post per link, media URL, poll e live collegati;
- riferimenti nei post e nei commenti verso articoli, stories, viaggi e tratte dell'app principale, salvati in `linked_resources`;
- riferimenti articolo apribili in modale interna alla community, con contenuto logbook e link esterno alla main app;
- auto-post community quando viene pubblicato un articolo della main app: testo generato via IA, riferimento all'articolo e autori multipli replicati dagli autori editoriali;
- CTA dai post live verso `/live?event=<id>` con stato derivato programmata/in corso/terminata;
- gestione Crew Pass spostata nel profilo principale `/profile` (`/profilo` redirect), riusando `profiles`;
- governance operativa in admin (`/admin?section=community`) per prezzi, ruoli moderator, canali, live modificabili, membership e pagamenti recenti;
- endpoint Bunq membership in [[10 - API Vercel]];
- migrazioni applicate sul progetto Supabase remoto; advisor filtrati sul dominio community puliti.

## Handoff nuova chat

Questa sezione è il punto di ripartenza operativo per continuare lo sviluppo in una nuova chat.

### Stato reale al 20 luglio 2026

Completato e verificato:
- sub-app `apps/crew` isolata dalla main app, base `/Crew/`, host `crew.biteproject.it`;
- login centralizzato su `login.biteproject.it`, sessione Supabase condivisa su `.biteproject.it`;
- vetrina pubblica su `/`, feed protetto su `/feed` e subfeed su `/feed/:channelSlug`;
- composer unico in cima al feed per `text`, `link`, `media`, `poll`, `live`;
- poll e live creati dal composer, non da pagine dedicate;
- LiveKit collegato tramite `/api/community/livekit-token`;
- live programmabili con `starts_at`, chat laterale e pulsante "Avvisami";
- stato live derivato in UI da `starts_at`/`ends_at`: programmata, in corso, terminata;
- token LiveKit viewer-only per membri e publishing solo admin;
- reminder live email/push tramite `community_live_event_reminders`, RPC SQL e Edge Function `dispatch-community-live-notifications`;
- Crew Pass con tier mensile/annuale, rinnovo manuale, pagamento 1-3 periodi via Bunq;
- gestione pass nel profilo principale `/profile`, con `/profilo` redirect;
- governance community in admin su `/admin?section=community`;
- ruolo `moderator` in `user_roles` per moderare commenti/live messages;
- post `link`, `media`, `poll` e `live` renderizzati come card dedicate nel feed e nel dettaglio;
- post e commenti possono allegare riferimenti a contenuti principali tramite picker: articoli pubblicati, stories, viaggi pubblicati e tratte prenotabili;
- i riferimenti articolo possono essere letti direttamente in modale nella community, seguendo il pattern di apertura contestuale del logbook;
- gli articoli pubblicati dalla main app creano automaticamente un post community tramite `sync-article-community-post`, con testo bilingue generato dalla IA già configurata e link all'articolo in `linked_resources`;
- i post supportano autori multipli tramite `community_post_authors`; per i post generati dagli articoli vengono copiati tutti gli autori editoriali, mentre `author_profile_id` resta il primo autore per retrocompatibilità;
- poll votabili anche inline dai post collegati, riusando `community_poll_option_stats`;
- post live collegati alla pagina `/live?event=<id>` con CTA e badge stato;
- admin community con modifica rapida di live già create: titolo, inizio/fine, accesso, tier minimo, modalità LiveKit e archiviazione;
- tipi Supabase rigenerati in `apps/web/src/integrations/supabase/types.ts` e `apps/crew/src/integrations/supabase/types.ts`;
- migrazioni community applicate al Supabase remoto `ekwloweuicrqjjgabfdp`;
- build monorepo verificata con `npm run build`.

Verifiche gia eseguite:
- `npx tsc --noEmit -p apps/crew/tsconfig.app.json`;
- `npx tsc --noEmit -p apps/web/tsconfig.app.json`;
- `npx tsc --noEmit -p apps/web/tsconfig.node.json`;
- `npm run build`;
- `supabase db push --linked --yes`;
- deploy Edge Function `dispatch-community-live-notifications`;
- `supabase db advisors --linked --type all --level warn --fail-on none` filtrato sui nuovi oggetti live reminder: nessun warning nuovo.

### File principali toccati finora

Frontend Crew:
- `apps/crew/src/pages/CrewHome.tsx` — vetrina/paywall;
- `apps/crew/src/pages/CrewFeedPage.tsx` — feed protetto, subfeed e composer unico;
- `apps/crew/src/pages/CrewPostPage.tsx` — dettaglio post con contenuto TipTap, card allegati/poll/live e discussione;
- `apps/crew/src/pages/CrewLivePage.tsx` — live programmati, stato derivato, room LiveKit, chat e reminder;
- `apps/crew/src/pages/CrewPollsPage.tsx` — voting/risultati, senza creazione separata;
- `apps/crew/src/components/CommunityReferences.tsx` — picker e card per riferimenti a logbook, stories, viaggi e tratte;
- `apps/crew/src/components/CommunityPostSurface.tsx` — card condivisa per link, media URL, poll inline e CTA live;
- `apps/crew/src/components/LivekitRoomPanel.tsx` — layout LiveKit admin/viewer;
- `apps/crew/src/components/CommunityComments.tsx` — commenti realtime/moderazione;
- `apps/crew/src/lib/community.ts` — tipi e helper community;
- `apps/crew/src/lib/auth-redirect.ts` — bridge verso `login.biteproject.it`.

Main app / admin:
- `apps/web/src/components/admin/AdminCommunityManager.tsx` — governance community;
- `apps/web/src/components/profile/ProfileCrewPassPanel.tsx` — gestione Crew Pass in `/profile`;
- `apps/web/api/payments/bunq/membership/request.ts` — richiesta pagamento membership;
- `apps/web/api/payments/bunq/membership/status.ts` — polling pagamento membership;
- `apps/web/api/community/livekit-token.ts` — token LiveKit e policy viewer/admin.

Supabase:
- `apps/web/supabase/migrations/20260719164335_community_membership.sql`;
- `apps/web/supabase/migrations/20260719171903_community_engagement_surfaces.sql`;
- `apps/web/supabase/migrations/20260719180813_community_livekit_manual_renewals.sql`;
- `apps/web/supabase/migrations/20260719182313_community_admin_governance.sql`;
- `apps/web/supabase/migrations/20260719183946_community_feed_channels.sql`;
- `apps/web/supabase/migrations/20260719190933_community_inline_composer_surfaces.sql`;
- `apps/web/supabase/migrations/20260720045907_community_live_reminders.sql`;
- `apps/web/supabase/migrations/20260720052234_community_content_references.sql`;
- `apps/web/supabase/migrations/20260720054231_community_article_auto_posts.sql`;
- `apps/web/supabase/migrations/20260720055619_community_post_authors_realtime.sql`;
- `apps/web/supabase/functions/dispatch-community-live-notifications/index.ts`;
- `apps/web/supabase/functions/sync-article-community-post/index.ts`;
- `apps/web/supabase/config.toml`.

### Decisioni gia prese

- Nome prodotto: **BITE Crew**.
- Nome abbonamento: **Crew Pass**.
- I rinnovi sono manuali per scelta di design, non un limite tecnico da nascondere.
- Bunq resta il flusso di pagamento one-shot; niente recurring automatico.
- Gli admin globali sono anche admin community.
- `moderator` modera contenuti community, ma non ha permessi LiveKit di regia.
- I membri live sono viewer-only: possono vedere/ascoltare e scrivere in chat, ma non attivano camera, microfono o screen share.
- Le live sono eventi programmati in anticipo, non room create come pagina separata.
- Poll e live si creano sempre dal composer del feed.
- La main app resta non contaminata da link pubblici alla community finché la community non è pronta al lancio.
- La gestione generale sta in admin, mentre la gestione dell'abbonamento utente sta in `/profile`.

### Pezzi mancanti prioritari

Da fare prima di considerare la community pronta:
- sostituire URL media manuali con upload dedicato foto/video/audio, probabilmente su bucket separato `community-media`;
- implementare webhook Bunq membership o worker server-side, oggi il pagamento si conferma via polling `/status`;
- implementare fallback bonifico per membership, se deve esistere anche per Crew Pass;
- creare template React Email dedicati per reminder membership/live invece dell'HTML minimale SQL;
- integrare benefit viaggio reali nel booking: early access, riduzione minimo fisso, audit benefit;
- aggiungere analytics community: iscritti attivi, churn, rinnovi in scadenza, conversione vetrina → pass;
- aggiungere test mirati per RLS/RPC community e token LiveKit;
- fare QA visuale responsive completa su `/`, `/feed`, `/live`, `/polls`, `/profile` e admin community;
- decidere quando rimuovere `noindex,nofollow` da `/Crew/*` e quando linkare la community dalla main app.

### Azioni umane/config richieste o da verificare

- DNS: puntare `crew.biteproject.it` e `login.biteproject.it` al deploy Vercel, se non gia fatto.
- Supabase Auth: mantenere allowed redirect URLs per `https://login.biteproject.it/**`, `https://biteproject.it/**`, `https://admin.biteproject.it/**`, `https://crew.biteproject.it/**`.
- Supabase passkey: Relying Party ID `biteproject.it`; origins includono almeno `https://login.biteproject.it`.
- Vercel env: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` per `/api/community/livekit-token`.
- Supabase Functions secrets: `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY`, `WEB_PUSH_VAPID_SUBJECT` per `dispatch-community-live-notifications`.
- Supabase Functions secrets/Vault: `EMAIL_QUEUE_CRON_SECRET` e `email_queue_cron_secret` devono combaciare per il cron email/push.
- VAPID client: verificare che gli utenti community possano iscriversi alle push, non solo gli admin nella PWA admin.
- LiveKit dashboard: creare/proteggere progetto e controllare limiti/costi prima del lancio pubblico.

### Comandi utili per ripartire

```bash
npm run build:crew
npx tsc --noEmit -p apps/crew/tsconfig.app.json
npx tsc --noEmit -p apps/web/tsconfig.app.json
npm run build
cd apps/web && supabase db push --linked --dry-run
cd apps/web && supabase gen types typescript --linked --schema public > src/integrations/supabase/types.ts
cp apps/web/src/integrations/supabase/types.ts apps/crew/src/integrations/supabase/types.ts
```

Quando si aggiunge una migrazione Supabase, crearla sempre con:

```bash
cd apps/web
supabase migration new nome_descrittivo
```

## Nome

**BITE Crew**.

Motivo: è breve, internazionale, coerente con barca/viaggio/equipaggio, e non suona come un clone di Patreon. Dice subito che non stai comprando un contenuto, stai entrando piu vicino alla crew. Funziona bene anche sul sottodominio: `crew.biteproject.it`.

Alternative valide:

| Nome | Pro | Contro |
|---|---|---|
| **BITE Crew** | chiaro, umano, bilingue, adatto a membership e viaggi | un po' generico se in futuro esistono anche ruoli crew operativi |
| **Spritz Crew** | piu legato alla barca, caldo e memorabile | se cambia barca o il progetto cresce oltre Spritz diventa stretto |
| **BITE Circle** | community/patrons senza tono nautico forzato | meno distintivo rispetto al progetto a vela |
| **BITE Backstage** | ottimo per contenuti dietro le quinte | riduttivo: copre peggio benefici viaggio e interazione |
| **BITE Quay** | poetico, luogo di incontro | meno immediato in italiano e per utenti non nautici |

Scelta implementata: **BITE Crew** come prodotto e **Crew Pass** come nome dell'abbonamento.

## Posizionamento

La community non deve essere solo un paywall. Deve diventare la quarta superficie del prodotto, accanto a:

1. sito editoriale pubblico;
2. area utente/booking;
3. admin;
4. **BITE Crew** su `crew.biteproject.it`.

Promessa: accesso piu vicino alla vita reale del progetto, con aggiornamenti live, conversazioni dirette, anteprime e vantaggi concreti sui viaggi, senza trasformare BITE in un prodotto turistico/charter.

Copy guida:
- preferire **membro**, **Crew Pass**, **sostieni il progetto**, **accesso anticipato**, **contributo ridotto/agevolato**;
- evitare **cliente**, **biglietto**, **tariffa**, **pacchetto turistico**, **charter**, **quota fissa viaggio gratuita** se il benefit tocca le prenotazioni.

## Tier iniziali

| Tier | Prezzo indicativo | Accesso | Benefit viaggio |
|---|---:|---|---|
| **Deck / Base** | 3 €/mese · 30 €/anno | feed riservato, commenti, poll, aggiornamenti live testuali | `early_access_hours = 24` |
| **Wake / Intermedio** | 5 €/mese · 50 €/anno | tutto Deck + live chat, Q&A e contenuti lunghi | `early_access_hours = 72` |
| **Harbor / Top** | 10 €/mese · 100 €/anno | tutto Wake + live room prioritarie, briefing privati e benefit viaggio accessori | `early_access_hours = 168`, `waive_fixed_minimum_cents = 2000` |

Ogni tier esiste come variante mensile e annuale (`billing_interval = month|year`) e può essere pagato per 1, 2 o 3 periodi alla volta. Non esistono rinnovi automatici: è una scelta di design esplicita. BITE non vuole addebiti dimenticati; il membro riceve un promemoria e rinnova solo se vuole continuare a far parte dell'equipaggio.

Regola consigliata per i viaggi: non azzerare il contributo per NM e complessita, perche quello rappresenta spese vive ripartite. Il benefit membership puo invece:
- eliminare/ridurre il minimo fisso da 20 euro;
- aprire candidature prima del pubblico;
- abilitare notifiche prioritarie;
- mostrare briefing o dettagli logistici in anticipo;
- applicare una priorita amministrativa dichiarata ma non automatica, perche la partecipazione resta soggetta a idoneita, sicurezza e composizione equipaggio.

## Architettura prodotto

### Hosting

`crew.biteproject.it` è una sub-app Vite dedicata in `apps/crew`, servita dallo stesso deploy Vercel con rewrite verso `/Crew`, come gia avviene per `pack.biteproject.it` e `data.biteproject.it`.

Tecnica:
- cartella: `apps/crew`;
- package: `@biteproject/crew`;
- build base path: `/Crew/`;
- sottodominio: `crew.biteproject.it` riscritto a `/Crew`;
- stesso Supabase project;
- stesso design system di `apps/web`, come `apps/data`, per evitare drift visivo.

### Auth

Usare lo stesso account Supabase del sito principale:
- login passwordless, OAuth e passkey restano centralizzati su `login.biteproject.it`;
- profilo unico in `profiles`;
- preferenze lingua riusate;
- avatar/bio/link social riusabili nella community;
- completamento profilo richiesto solo per funzioni dove serve identita reale o booking.

Per WebAuthn/passkey va mantenuto il principio gia documentato: i flussi sensibili partono dall'host auth dedicato, che deve essere compatibile con Relying Party ID e origins Supabase configurate. La sub-app usa `redirectToLogin()` per tornare al post/feed/studio originario dopo l'accesso.

### Dati membership

Tabelle:

| Tabella | Scopo |
|---|---|
| `membership_tiers` | definizione tier, prezzo, valuta, visibilita, ordinamento, benefit JSONB |
| `membership_subscriptions` | stato membership per profilo: tier, status, periodo, reminder rinnovo/scadenza |
| `membership_payments` | richieste Bunq/bonifico, stato pagamento, importi, `period_count` 1-3 e audit |
| `membership_benefit_events` | audit dei benefit applicati, es. early access o riduzione minimo fisso |
| `community_channels` | canali/subfeed stile Reddit con slug, ordine, stato attivo e accesso per tier |
| `community_posts` | contenuti riservati, con visibilita per tier, tipo post e canale |
| `community_post_authors` | autori multipli dei post community, inclusi quelli generati da articoli con più autori |
| `community_comments` | thread/commenti sui post |
| `community_reactions` | reaction semplici senza appesantire il modello |
| `community_live_events` | finestre live, Q&A, aggiornamenti in tempo reale |
| `community_live_messages` | messaggi realtime dei live event, moderabili |
| `community_live_event_reminders` | opt-in "Avvisami" per live programmati, con stato invio email/push pre-live e start |
| `community_polls` | domande/poll per input dei membri, opzionalmente legati a post |
| `community_poll_options` | opzioni dei poll |
| `community_poll_votes` | voti member-only, visibili direttamente solo al proprietario/admin |
| `community_poll_option_stats` | conteggi aggregati mantenuti da trigger, leggibili se il poll è leggibile |

RLS:
- contenuti pubblici leggibili da tutti solo se marcati pubblici;
- contenuti tier leggibili da utenti con subscription attiva a tier sufficiente;
- `/feed` è protetto dalla UI per account con membership attiva; la home `/` resta vetrina/paywall;
- i canali possono essere `public`, `members` o `tier` e filtrano anche i post collegati;
- commenti scrivibili solo da membri attivi;
- membri attivi possono pubblicare post propri `members`/`tier` nei canali accessibili;
- il composer del feed è il punto unico di creazione: testo, link, media URL, poll e live programmati vengono creati da `/feed`, non dalle pagine dedicate;
- la pubblicazione di un articolo della main app invoca `sync-article-community-post`, che crea/aggiorna un post `members` idempotente con `metadata.source_article_id`, testo generato via IA e riferimento all'articolo;
- `community_post_authors` replica tutti gli autori del post; per i post manuali viene inserito l'autore corrente, per quelli automatici vengono copiati gli autori di `article_authors`;
- i reminder live sono leggibili/modificabili solo dal proprietario o dagli admin; la dispatch è service-role/postgres;
- `admin` globale è anche admin community e può gestire tutto da `/admin?section=community`; `moderator` in `user_roles` può moderare commenti e live messages senza diventare admin globale;
- nessuna decisione autorizzativa basata su `user_metadata`.
- `community_channels`, `community_posts`, `community_post_authors`, `community_comments`, `community_reactions`, `community_live_events`, `community_live_messages`, `community_polls`, `community_poll_options`, `community_poll_votes` e `community_poll_option_stats` sono nella publication Realtime.

RPC admin:
- `admin_list_community_roles()` elenca admin, moderator e membri con subscription attiva per la governance community;
- `admin_set_community_moderator(profile_id, enabled)` aggiunge/rimuove solo il ruolo `moderator`, richiedendo `has_role(auth.uid(), 'admin')`.

### Pagamenti Bunq

Riusa il pattern Bunq esistente ma separando il dominio:
- `POST /api/payments/bunq/membership/request`;
- `GET /api/payments/bunq/membership/status`;
- il polling `/status` attiva la subscription quando Bunq segna la request-inquiry come pagata;
- importi ricalcolati server-side da `membership_tiers`, mai dal client;
- il client può passare `quantity` 1-3; il server moltiplica importo e durata;
- se l'utente rinnova lo stesso tier attivo, il nuovo periodo parte dalla scadenza corrente, non da `now()`;
- fallback bonifico e webhook/router membership restano da implementare.

Posizionamento prodotto: Bunq non viene usato per addebiti ricorrenti automatici. Il copy deve esplicitare che il rinnovo manuale è intenzionale: niente abbonamenti dimenticati, solo partecipazione rinnovata per scelta. `dispatch_membership_renewal_reminders()` accoda email automatiche attraverso la coda transazionale esistente quando la membership scade entro 7 giorni o risulta appena scaduta.

### LiveKit

I live sincroni usano LiveKit:
- `community_live_events.livekit_mode` definisce `video`, `audio`, `stage` o `off`;
- `community_live_events.livekit_room_name` conserva la room reale;
- `/api/community/livekit-token` genera token firmati server-side con `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET`;
- il frontend `CrewLivePage` usa `@livekit/components-react` e degrada sul thread testuale se LiveKit non è configurato;
- gli eventi live vengono programmati dal composer del feed con data/ora future;
- i membri vedono/ascoltano e scrivono nella chat laterale, ma non possono pubblicare microfono, camera o screen share;
- solo gli admin ricevono grant LiveKit `canPublish`, `canPublishData` e `roomAdmin`;
- i moderator continuano a moderare i messaggi live via RLS, ma non ricevono permessi di regia LiveKit;
- `community_live_event_reminders` abilita "Avvisami": `dispatch_community_live_event_email_reminders()` accoda le mail, mentre la Edge Function `dispatch-community-live-notifications` invia Web Push usando le subscription esistenti.

### Booking benefit

Integrare i benefit nel calcolo esistente senza cambiare la natura del contributo:
- `booking-deposit.ts` resta server-authoritative;
- aggiungere una funzione server/shared tipo `resolveActiveMembershipBenefit(profileId, voyageId)`;
- applicare solo benefit consentiti, per esempio `waive_fixed_minimum_cents` o `early_access_window_hours`;
- registrare ogni applicazione in `membership_benefit_events`;
- UI booking mostra il benefit come sostegno/community, non come sconto commerciale.

La candidatura anticipata richiede un'estensione a `get_public_voyage_leg_availability` o una nuova RPC che, per utenti membri, consideri finestre `booking_public_opens_at` e `booking_members_opens_at`.

## Esperienza utente

### Navigazione principale

Schermate minime:
- **Home vetrina**: posizionamento BITE Crew, tier Crew Pass e CTA; non mostra il feed completo.
- **Feed `/feed`**: stile Facebook, post piu recenti in alto, composer in cima e sidebar canali.
- **Composer feed**: crea direttamente testo, link esterni, media URL, poll con opzioni e live programmabili LiveKit/thread collegati al post e al canale corrente.
- **Subfeed `/feed/:channelSlug`**: canali tematici tipo Reddit, es. `boat-tips` e `ricette`, con accesso per tier.
- **Live**: room LiveKit video/audio/stage piu chat realtime laterale; creazione da composer, reminder "Avvisami", membri viewer-only, admin in regia e moderator/admin sui messaggi.
- **Polls**: vista aggregata per votare e leggere risultati; creazione da composer feed.
- **Discussioni**: commenti sui post e thread tematici leggeri.
- **Viaggi**: anteprime, early access, benefit applicabili, candidature gia integrate nel booking esistente.
- **Profilo main app**: tier attivo, rinnovo manuale, pagamenti e cambio tier via Bunq dentro `/profile`.

### Admin e studio

La gestione generale vive nell'admin esistente:
- `/admin?section=community` gestisce prezzi/tier, attivazione tier, canali/subfeed, ruoli moderator, snapshot iscrizioni/pagamenti e live programmate;
- gli admin esistenti non ricevono un ruolo community duplicato: `app_role = admin` resta la sorgente di verità e abilita accesso completo anche alla community.

Per tenere la main app incontaminata finché la parte editoriale non sarà pronta al 100%, la prima gestione dei post vive ancora dentro `apps/crew`:
- `/studio` crea un post;
- `/studio/:id` modifica un post;
- accesso consentito solo agli admin via RPC `has_role`;
- riusa `RichTextEditor`, `MediaFigure`, upload su bucket `logbook-media` e contenuto TipTap JSON bilingue come gli articoli.

## Roadmap

### Fase 1 - Fondazione

- [x] scegliere nome e dominio;
- [x] aggiungere `apps/crew` come sub-app;
- [x] creare schema membership + RLS;
- [x] creare listing tier e stato abbonamento;
- [x] implementare pagamento iniziale Bunq one-shot;
- [x] proteggere un feed riservato minimo.

### Fase 2 - Community reale

- [x] post admin riservati per tier;
- [x] commenti/reaction;
- [x] live event testuale;
- [x] poll member-only;
- [x] account membership con pagamenti e benefit;
- [x] gestione Crew Pass nel profilo principale;
- [x] home vetrina separata dal feed protetto `/feed`;
- [x] canali/subfeed gestibili da admin;
- [x] composer unico nel feed per testo/link/media/poll/live;
- [x] moderazione admin/moderator base;
- [x] LiveKit token endpoint e UI room base;
- [x] reminder email rinnovo manuale membership;
- [x] governance admin per prezzi, ruoli moderator, live e membership snapshot;
- notifiche push;
- upload foto/live media dedicati.

### Fase 3 - Integrazione viaggi

- early access su voyage;
- riduzione/esenzione minimo fisso;
- benefit visualizzato nel booking;
- audit benefit;
- dashboard admin per membri candidati.

### Fase 4 - Membership matura

- rinnovi e grace period;
- upgrade/downgrade;
- ricevute e storico pagamenti;
- metriche churn/retention;
- contenuti programmati.
- analytics cohort/retention e digest membri.

## Decisioni aperte

- Fallback bonifico per membership.
- Webhook Bunq membership, oggi coperto dal polling `/status`.
- Template React Email dedicato ai reminder membership: oggi la migrazione accoda HTML/testo minimale.
- Se il tier piu alto deve includere call/briefing privati o solo contenuti asincroni.
- Quanto forte deve essere la priorita sui viaggi: accesso anticipato e piu pulito di priorita automatica.
- Se gestire rinnovi mensili manuali via Bunq o valutare un provider subscription-native in futuro.

## Collegamenti
- [[01 - Architettura]] · [[11 - Pagamenti Bunq]] · [[13 - Booking Voyage]] · [[18 - Deploy e Configurazione]] · [[19 - Sub-App (pack e data)]] · [[08 - Supabase]]
