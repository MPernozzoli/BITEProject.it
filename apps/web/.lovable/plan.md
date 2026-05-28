## Analisi attuale dei consumi

Dopo aver esaminato il codice, i principali driver di consumo Lovable Cloud sono:

### 🔴 Polling costanti (egress + DB requests)
1. **`usePublicContentSnapshot`** — fa polling della "version" pubblica **ogni 2 minuti** per ogni utente attivo, per tutta la durata della sessione. Con anche solo 50 visitatori in pagina = ~1.500 query/h solo per il version-check.
2. **`ProfileNotificationsMenu`** — ricarica le notifiche **ogni 60 secondi** anche con dropdown chiuso, per ogni utente loggato.
3. **`useArticleReads` realtime channel** — apre un canale Postgres realtime su `logbook_articles` per ogni articolo aperto, solo per sincronizzare il `view_count`. Realtime ha costo per connessione persistente.

### 🟡 Query inefficienti
4. Diverse `select("*")` su tabelle grandi (`voyages`, `logbook_articles`, `newsletter_deliveries` con `.limit(800)` — quest'ultima molto pesante).
5. `AdminNewsletterManager` carica fino a 800 deliveries + tutti i subscribers in una volta.

### 🟡 Edge functions sempre attive
6. 28 edge function deployate. Quelle "public-*" (sitemap, llms, semantic, geo) probabilmente vengono richieste da bot/crawler frequentemente senza caching aggressivo.

### 🟢 Storage/auth
Sembrano già ottimizzati (no upload massivi, sessioni 30gg).

---

## Piano di ottimizzazione (zero impatto utente)

### 1. Allungare il polling del version-check pubblico
**File:** `src/hooks/usePublicContentSnapshot.ts`
- Portare `PUBLIC_CONTENT_VERSION_POLL_MS` da **2 min → 10 min**.
- Disattivare polling automatico se la tab è in background (già parzialmente fatto con `refetchIntervalInBackground:false`).
- Aumentare `PUBLIC_CONTENT_VERSION_STALE_MS` da 1 min → 5 min.
- **Risparmio stimato: ~80% di query version-check.** L'utente non se ne accorge: il refetch su window focus garantisce comunque freschezza quando torna attivo.

### 2. Notifiche: realtime invece di polling 60s
**File:** `src/components/ProfileNotificationsMenu.tsx`
- Sostituire `setInterval(60000)` con un canale realtime sulla tabella `notifications` filtrato per `user_id`. Una sola connessione persistente costa molto meno di un poll/min, e le notifiche arrivano istantaneamente (UX migliore).
- Fallback: refetch su window focus + apertura dropdown (già presente).
- **Risparmio: ~60 query/utente/h → praticamente 0.**

### 3. View count realtime → debounce/lazy
**File:** `src/hooks/useArticleReads.tsx`
- Il canale realtime su `logbook_articles` per il view_count è "lusso". Sostituirlo con: refetch del count solo quando l'utente torna alla tab (`visibilitychange`) o ogni 5 min se la pagina resta aperta a lungo.
- In alternativa, eliminare del tutto l'aggiornamento live: il view_count si aggiorna comunque al prossimo caricamento.
- **Risparmio: 1 connessione realtime persistente per ogni lettore.**

### 4. Sostituire `select("*")` con colonne esplicite
**File:** `src/lib/public-content.ts`, `src/pages/Voyages.tsx`, `src/pages/StoryPage.tsx`, `src/pages/PublicProfile.tsx`, `src/components/voyage/ExpandedArticleModal.tsx`
- Selezionare solo le colonne effettivamente usate dalle UI (escludere campi pesanti tipo `content_html_it`, `content_html_en` quando non servono in liste).
- **Risparmio: riduzione egress 30-60% su queste pagine** (in particolare le liste articoli/voyages).

### 5. Admin Newsletter: paginazione/lazy
**File:** `src/components/admin/AdminNewsletterManager.tsx`
- Caricare i 800 deliveries solo quando si apre la tab "Deliveries" (non all'apertura del manager).
- Selezionare solo colonne necessarie per la lista (no `*`).
- **Risparmio: query admin più leggera, meno load DB.**

### 6. Cache HTTP aggressiva sulle edge functions pubbliche
**File:** `supabase/functions/public-sitemap/index.ts`, `public-llms/index.ts`, `public-semantic/index.ts`, `public-geo/index.ts`
- Aggiungere header `Cache-Control: public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400`.
- Bot/crawler e CDN edge cachano la risposta → meno invocazioni della function.
- **Risparmio: -70-90% invocazioni edge da crawler.**

### 7. Pulizia edge functions inutilizzate (verifica)
Verificare se ci sono function deployate ma mai chiamate (es. `preview-transactional-email` solo per dev?). Se sì, eliminarle riduce la superficie billable.

---

## Impatto stimato totale
- **Database requests: -60/70%** (soprattutto da polling)
- **Realtime connections: -90%** (eliminato canale view_count)
- **Egress: -30/40%** (select mirate + cache HTTP)
- **Edge function invocations: -50%** (cache pubblica)

**Zero impatto sull'esperienza utente percepita.** Anzi, le notifiche realtime miglioreranno la UX rispetto al polling 60s.

---

## Cosa NON tocco
- Auth/sessioni (già ottimali).
- TanStack Query cache strategies generali (già buone con `gcTime` lunghi).
- Schema DB / RLS (cambiamenti rischiosi, non necessari per ottimizzare costi).
- AI Gateway (consumi separati, già su modelli economici Gemini Flash).

Procedo step-by-step in modalità build dopo la tua approvazione, oppure dimmi se vuoi prioritizzare solo alcuni punti (es. solo 1-2-3 che sono quelli a impatto maggiore).