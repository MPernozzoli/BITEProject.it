# Newsletter — audit critico e piano di miglioramento

Data analisi: 2026-07-25 · Sorgenti lette: `apps/web/supabase/functions/{newsletter-*,process-email-queue,send-newsletter-digest,confirm-newsletter-subscription,handle-email-unsubscribe,_shared/*}`, `apps/web/src/components/admin/AdminNewsletterManager.tsx`, `apps/web/src/lib/newsletter.ts`, migrazioni (`apps/web/supabase/migrations`, `supabase/migrations`, `docs/migration/initial_schema_20260528.sql`).

> Nota di metodo: l'accesso SQL a produzione non era disponibile durante l'analisi. Le voci marcate **[VERIFICARE]** sono deduzioni dal codice che vanno confermate sul DB prima di agire: la query esatta è indicata di volta in volta.

---

## Stato implementazione (2026-07-25)

Già scritto e verificato in locale (`tsc` pulito, nessun nuovo errore di lint), **non ancora applicato in produzione** — vedi §5 per il motivo.

| Voce del piano | Stato | Dove |
|---|---|---|
| 1.2 Header `List-Unsubscribe` one-click | ✅ fatto | `process-email-queue/index.ts`, nuovo `api/email/unsubscribe.ts` |
| 1.3 Open redirect del click tracking | ✅ fatto | `newsletter-track-click/index.ts` |
| 1.4 Contatori atomici open/click | ✅ fatto | migrazione `20260725100000`, entrambe le funzioni di tracking |
| 1.5 Filter injection + rate limit per IP | ✅ fatto | `newsletter-subscribe/index.ts`, migrazione `20260725101000` |
| 1.6 Cron di dispatch | ✅ fatto | migrazione `20260725100000` (`invoke_newsletter_dispatch()`, ogni 5 min) |
| 1.5-bis Confronto segreti a tempo costante | ✅ fatto | `_shared/service-auth.ts`, `newsletter-dispatch`, `process-email-queue` |
| D8 Link allineati al dominio mittente (tracking newsletter + verifica auth) | ✅ fatto | `api/t/click.ts`, `api/t/open.ts`, `api/auth/verify.ts`, `newsletter-dispatch`, `auth-email-hook` |
| 1.1 Schema campagne versionato | ⏸️ da fare | richiede il dump dello schema reale da produzione |
| Fasi 2-4 | ⏸️ da fare | — |

Per esplicita indicazione, **la bonifica dell'arretrato di `newsletter_events` non è stata eseguita**: non ci sono ancora nuovi iscritti, quindi al primo giro del cron non c'è un'ondata di automazioni vecchie da temere.

---

## 0. Sintesi in una pagina

L'architettura di base è buona: double opt-in vero, coda PGMQ con retry/backoff/DLQ/TTL, tracking open/click, preferenze granulari, i18n con fallback linguistico, idempotency key verso Resend. Il problema non è il design, sono tre cose:

1. **Metà del motore non è collegata.** Non esiste alcun cron che invochi `newsletter-dispatch`: campagne schedulate, automazioni su iscrizione/disiscrizione e digest settimanale **non partono mai da soli**. L'unico modo di spedire è il bottone "Invia ora" nell'admin.
2. **Non regge il volume.** Con la configurazione attuale la coda smaltisce circa **120 email/ora**; il dispatch è un loop sequenziale che renderizza il template React una volta per destinatario dentro una singola invocazione edge.
3. **Manca il livello operativo.** Niente invio di test, niente conferma prima di spedire a tutta la lista, niente duplicazione di una campagna, niente segmentazione, niente stato di avanzamento. Ogni invio è un atto di fede.

A questo si aggiungono un **open redirect** sul tracking dei click, l'assenza degli header **`List-Unsubscribe`** (obbligatori per i bulk sender Gmail/Yahoo/Microsoft, e con il lato server già implementato) e **metriche sbagliate** perché calcolate nel browser su una finestra di 300 righe.

Ordine di lavoro consigliato: **Fase 0** (verifiche, 1 giorno) → **Fase 1** (blocchi funzionali e sicurezza, ~1 settimana) → **Fase 2** (scala, ~1 settimana) → **Fase 3** (flusso operativo admin, ~1-2 settimane) → **Fase 4** (qualità e crescita, continuo).

---

## 1. Diagnosi

### 1.1 Blocchi funzionali

**B1 — Nessun cron per `newsletter-dispatch`.** L'unico chiamante nel repo è [AdminNewsletterManager.tsx:768](apps/web/src/components/admin/AdminNewsletterManager.tsx:768). I cron registrati nelle migrazioni coprono coda email, articoli, social, booking e stati viaggio; nessuno tocca la newsletter. Conseguenze a catena:
- il campo "Schedulazione" nel composer produce una campagna in stato `scheduled` che **resta lì per sempre**;
- le automazioni `subscribed`/`unsubscribed` non vengono mai valutate: `newsletter_events` si accumula con `processed_at` null;
- `processWeeklyDigestAutomation()` vive dentro `newsletter-dispatch` ([newsletter-dispatch/index.ts:140](apps/web/supabase/functions/newsletter-dispatch/index.ts:140)), quindi **il digest settimanale non è mai partito**, nonostante l'UI lo mostri come "Attiva" con tanto di giorno e ora configurabili.

**[VERIFICARE]** `select jobname, schedule, active from cron.job order by jobname;` — confermare che non ci sia un job aggiunto a mano dalla dashboard.

**B2 — Lo schema del motore campagne non è versionato.** `newsletter_messages`, `newsletter_deliveries`, `newsletter_events`, `system_email_automations`, `email_unsubscribe_tokens` e le colonne `preferred_language` / `source` su `newsletter_subscribers` non compaiono in nessuna delle 119 migrazioni né nello schema iniziale. Esistono solo in produzione, create fuori dal controllo di versione. Da qui discendono tre problemi concreti:
- i cast `(supabase as any)` sparsi in tutto l'admin, che disattivano il type-checking proprio sulle tabelle più delicate;
- `normalizeOptionalSelectResult()` ([lib/newsletter.ts:66](apps/web/src/lib/newsletter.ts:66)) **converte "tabella inesistente" in "nessun dato"**: se una tabella sparisce o una policy blocca la lettura, la dashboard mostra zeri sereni invece di un errore;
- le **policy RLS di queste tabelle non sono ispezionabili nel repo**. `newsletter_deliveries` contiene l'email di ogni iscritto ed è letta direttamente dal browser: va verificato che un utente autenticato non-admin non possa leggerla.

**[VERIFICARE]** (priorità massima)
```sql
select tablename, policyname, roles, cmd, qual
from pg_policies
where tablename in ('newsletter_messages','newsletter_deliveries','newsletter_events','system_email_automations','email_unsubscribe_tokens');
```

**B3 — `newsletter_subscribers.profile_id` è `not null unique`** nello schema di record ([initial_schema:406](docs/migration/initial_schema_20260528.sql:406)), ma l'attivazione inserisce `profile_id: … ?? null` per chi si iscrive senza account ([newsletter-subscription-activation.ts](apps/web/supabase/functions/_shared/newsletter-subscription-activation.ts)). Se lo schema di produzione non è driftato, **l'iscrizione anonima dalla homepage fallisce**. Inoltre non c'è unique su `email`: due righe con la stessa email sono possibili e farebbero esplodere i `.maybeSingle()` del flusso di iscrizione.

**[VERIFICARE]** `select column_name, is_nullable from information_schema.columns where table_name='newsletter_subscribers';` e `select email, count(*) from newsletter_subscribers group by 1 having count(*)>1;`

### 1.2 Sicurezza

**S1 — Open redirect in `newsletter-track-click`** ([index.ts](apps/web/supabase/functions/newsletter-track-click/index.ts)). Se la coppia `delivery`/`token` non trova nulla, la funzione **redirige comunque** verso `decodedTarget`. Chiunque può costruire `…/newsletter-track-click?delivery=x&token=y&url=https://sito-malevolo` e ottenere un redirect 302 dal dominio Supabase del progetto: vettore di phishing e danno diretto alla reputazione del dominio. Deve fallire chiuso, e idealmente l'URL va firmato in HMAC.

**S2 — Contatori non atomici.** Sia open che click fanno read-modify-write su `open_count`/`click_count`. Aperture concorrenti (frequentissime: proxy immagini, client multipli) si perdono. Serve un incremento atomico lato SQL.

**S3 — Filter injection PostgREST** in `newsletter-subscribe`: `.or(\`email.eq.${normalizedEmail},profile_id.eq.${…}\`)` costruito per concatenazione, con una regex email permissiva (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`) che **accetta virgole e parentesi**. Impatto limitato (lettura di una riga subscriber), ma è una injection reale in un endpoint pubblico non autenticato.

**S4 — Nessun rate limit per IP** su `newsletter-subscribe`. C'è honeypot e cooldown di 15 minuti *per indirizzo*, ma nulla impedisce di iterare su migliaia di indirizzi diversi usando il vostro dominio per spedire mail di conferma non richieste.

**S5 — Confronto non constant-time** del service role key in `authorizeRequest` (minore, ma banale da correggere).

### 1.3 Deliverability e conformità

**D1 — Mancano gli header `List-Unsubscribe` e `List-Unsubscribe-Post`.** `sendResendEmail()` invia solo `X-BITE-Message-ID` ([process-email-queue/index.ts:55](apps/web/supabase/functions/process-email-queue/index.ts:55)). È il gap più assurdo del sistema, perché **il lato ricevente è già implementato**: `handle-email-unsubscribe` gestisce già il POST `List-Unsubscribe=One-Click` secondo RFC 8058, e il payload in coda contiene già `unsubscribe_token`. Mancano tre righe. Senza questi header siete fuori dai requisiti bulk sender di Gmail/Yahoo/Microsoft.

**D2 — Footer senza identità del mittente né indirizzo postale.** `newsletter-email.tsx` mette solo il "perché ricevi questa email" e il link di disiscrizione. Manca ragione sociale e indirizzo fisico.

**D3 — Nessuna prova di consenso.** Non si registrano IP, user-agent, timestamp e versione del testo di consenso al momento dell'iscrizione. L'art. 7(1) GDPR richiede di poter *dimostrare* il consenso; oggi si può dimostrare solo che esiste una riga `subscribed = true`.

**D4 — Nessun monitoraggio di bounce e complaint, nessuna rampa di warm-up.** Non c'è soglia di stop automatico (Gmail chiede spam rate stabilmente sotto lo 0,3%), né throttling progressivo per un dominio che manda poco e poi improvvisamente manda a tutta la lista.

**D5 — La parte testuale perde tutti gli URL.** `stripHtml()` rimuove i tag `<a>` mantenendo solo il testo dell'anchor: chi legge in plain text vede "Leggi l'articolo" senza alcun link. Penalizzante per i filtri antispam e inutilizzabile per l'utente.

**D6 — Aperture inaffidabili.** Nessun filtro per Apple Mail Privacy Protection, proxy immagini Gmail e scanner di sicurezza: l'open rate mostrato è gonfiato di una quantità ignota. I click con user-agent da scanner inflazionano anche il click rate.

**D8 — Tutti i link delle newsletter puntano a un dominio diverso dal mittente.** `newsletter-dispatch` costruisce il tracking su `${SUPABASE_URL}/functions/v1/...`, e `rewriteTrackedLinks()` riscrive **ogni** `href` del corpo verso quel dominio; anche il pixel di apertura sta lì. Il risultato è che un'email spedita da `mail.biteproject.it` contiene il 100% dei link su `ekwloweuicrqjjgabfdp.supabase.co`. È esattamente il segnale che Resend segnala come "Ensure link URLs match sending domain", e sulla newsletter pesa molto più che sulle email di autenticazione, dove il link disallineato è uno solo.

✅ **Risolto con la proxy** (2026-07-25), scartato il custom domain Supabase per non aggiungere costi: `newsletter-dispatch` costruisce il tracking su `${PUBLIC_SITE_URL}/api/t`, e le route `api/t/click.ts` / `api/t/open.ts` registrano l'evento chiamando direttamente le RPC — un solo hop, non due. Stessa cura per il link di verifica delle email di autenticazione, ora su `/api/auth/verify` (vedi §1.3-bis). Le edge function di tracking restano pubblicate per le email già spedite.

**D7 — Template.** Google Fonts caricati via `<link>` nell'`<head>` (rimosso da quasi tutti i client), nessun `color-scheme`/`prefers-color-scheme` (in dark mode su Apple Mail e Outlook la card beige si rompe), nessun link "visualizza nel browser".

### 1.4 Scala e prestazioni

**P1 — Throughput della coda: ~120 email/ora.** `process-email-queue` legge batch di 10 messaggi, con 200 ms di pausa fra un invio e l'altro, e il cron gira ogni 5 minuti. Una lista da 1.000 iscritti richiede **oltre 8 ore**. Resend espone `/emails/batch` (fino a 100 messaggi per chiamata) e limiti di rate molto più alti.

**P2 — `newsletter-dispatch` è O(N) sequenziale in una singola invocazione.** Per ogni destinatario: lettura/creazione del token di disiscrizione, risoluzione delle traduzioni, `renderAsync` del template React, insert della delivery, `enqueue_email`. Su una lista media va in timeout a metà lavoro; e siccome non esiste un cron che lo richiami, **la campagna resta bloccata in stato `sending` senza che nessuno la riprenda**. (Il set `alreadyQueued` evita i duplicati alla ripresa: la struttura per riprendere c'è, manca chi la invoca.)

**P3 — Il template viene renderizzato una volta per destinatario.** È identico per tutti tranne merge tag e URL di tracking: va renderizzato **una volta per lingua** e poi personalizzato per sostituzione.

**P4 — L'HTML completo viene duplicato in coda per ogni destinatario.** Il payload PGMQ porta l'intero body: con 1.000 destinatari e 50 KB di HTML sono 50 MB di righe di coda per una singola campagna.

**P5 — Digest senza limite di concorrenza.** `Promise.allSettled` su *tutti* i destinatari, ognuno con una fetch verso `send-transactional-email` ([send-newsletter-digest/index.ts:292](apps/web/supabase/functions/send-newsletter-digest/index.ts:292)).

### 1.5 Metriche sbagliate

**M1 — Open rate e click rate sono numericamente falsi.** L'admin scarica le ultime **300** consegne (`limit(300)`) e calcola tutto in memoria, incluse le metriche *per singola campagna* (`getMessageMetrics` filtra la stessa finestra). Superate 300 consegne totali, ogni percentuale mostrata è arbitraria.

**M2 — Tutti gli iscritti vengono scaricati nel browser** solo per contarli — peso e superficie privacy inutili.

**M3 — La campagna viene marcata `sent` appena accodata**, non a invio completato: la UI dice "Inviato" mentre la coda ha ancora ore di lavoro davanti.

**M4 — Bounce e complaint non risalgono a `newsletter_deliveries`.** Il webhook Resend esiste per la mail app ma non aggiorna le consegne newsletter: non si sa quale campagna ha generato quali bounce.

### 1.6 Flusso operativo — dove si perde davvero tempo

| # | Mancanza | Costo |
|---|---|---|
| O1 | **Nessun invio di test.** Non esiste modo di mandarsi la mail prima di spedirla a tutti. `preview-transactional-email` copre solo i template transazionali. | È la lacuna numero uno: ogni invio è a rischio refuso permanente. |
| O2 | **"Invia ora" senza conferma.** Un click imposta `scheduled_at = now`, stato `scheduled` e spedisce a tutta la lista. Nessun dialog, nessun annulla, nessun controllo che la campagna non sia già stata inviata. | Un errore di click è irreversibile. |
| O3 | **Niente duplica / elimina / archivia.** | Ogni edizione si riscrive da zero. |
| O4 | **Nessuna segmentazione.** Ogni campagna va a tutti gli iscritti attivi: nessun filtro per lingua, data di iscrizione, sorgente, engagement. | Impossibile fare re-engagement, benvenuto differenziato, invii per lingua. |
| O5 | **Anteprima infedele.** Il pannello di destra è una ricostruzione in React, non il template `NewsletterEmail` reale, e legge solo `bodyHtmlTranslations` (in rich text mostra l'HTML derivato, non il rendering finale). Nessuna vista mobile né dark. Il bottone "Anteprima" a riga ~1707 **non ha alcun `onClick`**. | Si scopre com'è fatta la mail quando è già partita. |
| O6 | **Nessun controllo pre-volo.** Nessuna validazione di link rotti, immagini senza `alt`, subject troppo lungo, preheader mancante. `renderMergeTags` sostituisce i tag sconosciuti con stringa vuota **in silenzio**: un `{{firstname}}` al posto di `{{first_name}}` produce "Ciao ," senza un avviso. | Errori sistematici e invisibili. |
| O7 | **Traduzioni manuali.** IT/EN obbligatorie, le altre quattro lingue si compilano a mano una alla volta, mentre `translate-editor-content` esiste già ed è usata per gli articoli. | Le lingue opzionali restano vuote. |
| O8 | **Nessuno stato di avanzamento.** Durante un invio l'admin non vede quante mail sono partite, quante sono in coda, quante fallite, se la coda è in cooldown per rate limit. | Nessun modo di sapere se sta funzionando. |
| O9 | Componente monolitico da **1.958 righe**, `getMessageMetrics`/`getMessageReadiness` ricalcolati a ogni render per ogni card. | Manutenzione lenta, UI che rallenta con la lista. |

---

## 2. Piano di miglioramento

### Fase 0 — Verifiche (mezza giornata, bloccante)

Prima di scrivere una riga di codice, chiarire lo stato reale di produzione. Le tre query sono già indicate sopra: policy RLS delle tabelle campagne, `cron.job`, nullabilità/duplicati di `newsletter_subscribers`. In aggiunta:

```sql
-- volumi reali: dimensionano tutte le scelte successive
select
  (select count(*) from newsletter_subscribers where subscribed) as attivi,
  (select count(*) from newsletter_deliveries)                   as consegne,
  (select count(*) from newsletter_events where processed_at is null) as eventi_arretrati,
  (select count(*) from suppressed_emails)                       as soppressi;

-- campagne rimaste bloccate
select id, name, status, scheduled_at, sent_at from newsletter_messages order by updated_at desc limit 20;

-- stato della coda
select * from email_send_state;
select status, count(*) from email_send_log group by 1;
```

**Esito atteso:** un quadro chiaro di quali problemi sono teorici e quali sono già in produzione. Se `eventi_arretrati` è alto, sono automazioni mai partite da recuperare o da archiviare esplicitamente prima di attivare il cron (altrimenti al primo giro parte un'ondata di mail di benvenuto vecchie di mesi — **questo è un rischio reale della Fase 1, va gestito**).

### Fase 1 — Chiudere i blocchi e le falle (~1 settimana)

**1.1 Portare lo schema campagne sotto controllo di versione.** Estrarre il DDL reale da produzione (`pg_dump --schema-only` sulle tabelle interessate) e scriverlo in una migrazione `create table if not exists` + policy esplicite, così che l'ambiente sia ricostruibile. Rigenerare `types.ts` e **rimuovere i cast `(supabase as any)`** dall'admin. Contestualmente restringere `normalizeOptionalSelectResult` in modo che il silenziamento valga solo in sviluppo: in produzione un errore deve essere visibile.

**1.2 Header `List-Unsubscribe`.** In `sendResendEmail`, quando il payload ha `unsubscribe_token`:
```
List-Unsubscribe: <https://…/unsubscribe?token=…>, <mailto:unsubscribe@mail.biteproject.it?subject=unsubscribe>
List-Unsubscribe-Post: List-Unsubscribe=One-Click
```
Il target POST è già implementato lato server. **Massimo ritorno per il minimo sforzo dell'intero piano.**

**1.3 Chiudere l'open redirect.** In `newsletter-track-click`: se la coppia delivery/token non valida, redirigere a `PUBLIC_SITE_URL` e non al target richiesto. In più, firmare il parametro `url` con HMAC (chiave in secret) e verificarlo prima del redirect.

**1.4 Contatori atomici.** Sostituire il read-modify-write con una funzione SQL `newsletter_register_open(delivery_id, token)` / `newsletter_register_click(...)` che fa `update … set open_count = open_count + 1` in una sola istruzione.

**1.5 Injection e rate limit su `newsletter-subscribe`.** Sostituire il `.or()` per concatenazione con due query separate (o `.in()` su valori parametrizzati); stringere la regex email; aggiungere rate limit per IP (tabella o Redis/Upstash) con soglia tipo 5 tentativi/ora.

**1.6 Attivare il cron di dispatch** — **solo dopo aver bonificato gli eventi arretrati**:
```sql
select cron.schedule('newsletter-dispatch', '*/5 * * * *',
  $$select public.invoke_newsletter_dispatch();$$);
```
sul modello di `invoke_email_queue_worker()` (autenticazione via `x-cron-secret`, non via service key nell'header). Prima del primo giro: marcare `processed_at = now()` con una nota esplicita su tutti gli eventi più vecchi di X giorni.

**Criterio di accettazione Fase 1:** una campagna schedulata per fra 10 minuti parte da sola; una mail ricevuta in Gmail mostra il link "Annulla iscrizione" nativo accanto al mittente; `newsletter-track-click` con token falso non redirige più fuori dominio; lo schema si ricrea da zero con `supabase db reset`.

### Fase 2 — Reggere il volume (~1 settimana)

**2.1 Render una volta per lingua, non per destinatario.** Ristrutturare `queueNewsletterDelivery` così: per ogni lingua presente fra i destinatari, renderizzare il template una volta con segnaposto (`__UNSUB_URL__`, `__PIXEL_URL__`, `__FIRST_NAME__`, …); poi per ogni destinatario fare solo sostituzione di stringhe. Riduzione di CPU stimata di uno o due ordini di grandezza.

**2.2 Dispatch a lotti riprendibile.** `newsletter-dispatch` lavora su una pagina di N destinatari (es. 200), poi si auto-richiama (o lascia che il cron continui) finché non ha finito. Aggiungere su `newsletter_messages` un `dispatch_cursor` e i contatori `recipients_total` / `recipients_queued`. Lo stato passa a `sent` **solo quando la coda è vuota per quella campagna**, non all'accodamento (risolve anche M3).

**2.3 Batch verso Resend.** Nel worker, raggruppare fino a 100 messaggi omogenei in una chiamata `/emails/batch`, mantenendo l'idempotency key per messaggio. Alzare `batch_size` e ridurre `send_delay_ms` in `email_send_state`, con un cron a 1 minuto quando c'è una campagna in corso. Obiettivo: da ~120 email/ora a **migliaia/ora**.

**2.4 Non duplicare l'HTML in coda.** Mettere in coda un riferimento (`newsletter_message_id` + lingua + variabili del destinatario) e far comporre il body al worker leggendo il render cachato per lingua. Alleggerisce PGMQ di ordini di grandezza.

**2.5 Concorrenza limitata nel digest.** Sostituire `Promise.allSettled` su tutta la lista con un pool a concorrenza fissa (es. 10) e paginazione.

**2.6 Metriche in SQL.** Vista materializzata o rpc `newsletter_campaign_stats(message_id)` che restituisce inviati/aperti/cliccati/soppressi/falliti aggregati lato database. L'admin legge quella e **smette di scaricare 300 consegne e l'intera lista iscritti** (risolve M1 e M2).

**Criterio di accettazione Fase 2:** una campagna su una lista di test da 1.000 indirizzi (usare un servizio di seed/mailtrap) completa in meno di 15 minuti, con stato e contatori corretti in dashboard a fine invio.

### Fase 3 — Rendere il flusso operativo decente (~1-2 settimane)

Questa è la fase che cambia la vita a chi scrive le newsletter.

**3.1 Invio di test.** Nuovo endpoint `newsletter-send-test` (admin-only) che renderizza *esattamente* la pipeline reale — stesso template, stessi merge tag, stesso tracking disattivato — e spedisce a uno o più indirizzi indicati. Bottone "Invia test a me" nel composer, sempre visibile. **Da fare per primo in questa fase.**

**3.2 Conferma d'invio seria.** Dialog che mostra: nome campagna, segmento e **numero esatto di destinatari**, lingue coperte, anteprima del subject per lingua, avvisi pre-volo. Richiesta di digitare il nome della campagna per confermare. Dopo la conferma, finestra di annullamento di 60 secondi prima che il dispatch parta davvero. Blocco esplicito se `status = 'sent'`.

**3.3 Controlli pre-volo automatici.** Prima dell'invio, verificare: subject presente e sotto i ~60 caratteri, preheader presente, **merge tag sconosciuti** (oggi falliscono in silenzio — far diventare `renderMergeTags` strict con lista di tag noti), link raggiungibili, immagini con `alt` e URL assoluti, presenza del link di disiscrizione, peso HTML sotto i 102 KB (soglia di clipping Gmail).

**3.4 Duplica / elimina / archivia** campagna, con `duplicate` che copia tutte le traduzioni e azzera stato e schedulazione.

**3.5 Segmentazione.** Tabella `newsletter_segments` con definizione dichiarativa (lingua, sorgente, data iscrizione, engagement negli ultimi N invii, tag manuali) risolta in SQL al momento del dispatch, con anteprima del conteggio nel composer. È il prerequisito di qualunque strategia editoriale seria.

**3.6 Anteprima fedele.** Il pannello di destra deve mostrare **il render reale** del template (chiamata a un endpoint di preview che restituisce l'HTML finale in un iframe sandboxed), con toggle desktop/mobile e light/dark. Collegare finalmente il bottone "Anteprima" morto.

**3.7 Stato di avanzamento in tempo reale.** Nella card della campagna: barra con accodati / inviati / falliti / soppressi, stato della coda (incluso il cooldown da rate limit letto da `email_send_state.retry_after_until`), ultimo errore. Aggiornamento via Supabase Realtime o polling.

**3.8 Traduzioni assistite.** Riusare `translate-editor-content` per proporre le quattro lingue opzionali a partire da IT/EN, con revisione manuale obbligatoria prima del salvataggio.

**3.9 Spezzare il componente.** Da 1.958 righe a moduli per tab (`Overview`, `Campaigns`, `Automations`, `Composer`) con i dati serviti da hook React Query dedicati; memoizzare metriche e readiness.

**Criterio di accettazione Fase 3:** creare, tradurre, testare su di sé, verificare e spedire una campagna reale senza mai aprire il database né una edge function a mano.

### Fase 4 — Qualità, conformità, crescita (continuo)

- **Prova di consenso:** aggiungere a `newsletter_subscribers` (o a una tabella `newsletter_consents` append-only) `consent_ip`, `consent_user_agent`, `consent_at`, `confirmed_at`, `consent_source`, `consent_text_version`. Necessario per il GDPR e utile in caso di contestazione di spam.
- **Footer conforme:** identità del mittente e indirizzo postale nel template; link "visualizza nel browser".
- **Plain text vero:** generare la parte testuale mantenendo gli URL (`testo dell'anchor (https://…)`), invece di scartarli.
- **Igiene della lista:** hard bounce → soppressione automatica dal webhook Resend, con aggiornamento della delivery corrispondente (chiude M4); soppressione dopo N soft bounce consecutivi; campagna di re-engagement e rimozione dei mai-aperti dopo 12 mesi.
- **Soglie di sicurezza:** blocco automatico degli invii se il tasso di bounce di una campagna supera il 2% o i reclami lo 0,3%; dashboard con le due metriche per campagna.
- **Aperture credibili:** filtrare i proxy noti (Apple MPP, GoogleImageProxy) e gli user-agent da scanner; distinguere "aperture grezze" da "aperture umane stimate" nella UI, e **portare il click rate come metrica primaria** al posto dell'open rate.
- **Template:** rimuovere i `<link>` a Google Fonts, aggiungere `color-scheme: light dark` e le regole `prefers-color-scheme`.
- **A/B test sul subject** su una frazione della lista con invio automatico del vincente al resto — utile solo una volta che la segmentazione (3.5) esiste.
- **Test automatici:** unit test su `resolveTranslatedEntry`, `buildFallbackLanguages`, `renderMergeTags` (inclusa la modalità strict), `rewriteTrackedLinks`, `stripHtml`; test di integrazione del ciclo iscrizione → conferma → benvenuto → disiscrizione one-click.
- **Aggiornare `Wiki/12 - Newsletter ed Email.md`**, che oggi descrive digest e automazioni come funzionanti.

---

## 3. Priorità per rapporto valore/sforzo

| Priorità | Intervento | Sforzo | Perché adesso |
|---|---|---|---|
| 🔴 1 | Verifiche Fase 0 (RLS in testa) | 0,5 g | Possibile esposizione della lista iscritti |
| 🔴 2 | Header `List-Unsubscribe` (1.2) | 1 h | Lato server già pronto; requisito bulk sender |
| 🔴 3 | Open redirect click tracking (1.3) | 2 h | Falla sfruttabile dall'esterno |
| 🔴 4 | Cron dispatch + bonifica arretrati (1.6) | 0,5 g | Metà del prodotto è spenta |
| 🟠 5 | Invio di test (3.1) | 1 g | Elimina il rischio maggiore di ogni invio |
| 🟠 6 | Conferma + pre-volo (3.2, 3.3) | 2 g | Rende l'invio reversibile e verificato |
| 🟠 7 | Metriche in SQL (2.6) | 1 g | Oggi i numeri mostrati sono falsi |
| 🟠 8 | Schema versionato (1.1) | 1-2 g | Sblocca ogni intervento successivo |
| 🟡 9 | Render per lingua + batch (2.1, 2.3) | 3 g | Necessario oltre le poche centinaia di iscritti |
| 🟡 10 | Dispatch riprendibile (2.2) | 2 g | Evita campagne bloccate a metà |
| 🟡 11 | Segmentazione (3.5) | 3 g | Prerequisito editoriale |
| 🟢 12 | Prova di consenso, footer, plain text (Fase 4) | 2 g | Conformità |

---

## 4. Deploy bloccato: storia delle migrazioni fuori sincrono

`supabase db push` **non è stato eseguito**, e non va eseguito alla cieca. `supabase migration list` mostra che repo e produzione hanno divergito, in entrambe le direzioni:

**Locali mai applicate in produzione** (tutte precedenti al mio lavoro, tutte sul dominio booking):
`20260722150000_schedule_delay_admin_autoaccept_and_ack`, `20260724090000_fix_admin_invite_profile_id`, `20260724091500_admin_apply_pending_invite_legs`, `20260724092000_admin_reads_booking_participants`, `20260724100000_reactivate_expired_voyage_booking`, `20260724110000_settle_accepted_invite_payment`, `20260724120000_confirm_booking_requires_payment`.

**Applicate in produzione ma assenti dal repo** (23 luglio, verosimilmente eseguite da dashboard o MCP):
`20260723220327`, `20260723222616`, `20260723223107`, `20260723230428`, `20260723231918`.

Un `db push` applicherebbe quindi **sette migrazioni booking non mie** insieme alle due della newsletter, in un'area che sul remoto è già stata modificata da cinque migrazioni che qui non abbiamo. È lavoro altrui potenzialmente incompleto: non è una decisione che spetta a me prendere in produzione. Docker non è disponibile su questa macchina, quindi non è stato possibile validare le migrazioni nemmeno contro un DB shadow locale.

**Come sbloccare**, una volta deciso cosa fare del disallineamento booking:

```bash
supabase migration list
```

Se le sette migrazioni booking sono da applicare, il push le include automaticamente:

```bash
supabase db push
```

Se invece vanno tenute fuori, applicare solo le due della newsletter e registrarle in storia:

```bash
supabase db push --include-all=false --dry-run
```

**L'ordine di deploy non è indifferente: prima Vercel, poi le edge function.** I link di tracking e di verifica auth ora puntano a route Vercel (`/api/t/*`, `/api/auth/verify`, `/api/email/unsubscribe`): se le edge function partissero per prime, nella finestra intermedia le email uscirebbero con link verso route non ancora esistenti — comprese le conferme di iscrizione account.

Dopo il deploy Vercel e il push del database, ridistribuire le edge function toccate:

```bash
supabase functions deploy newsletter-dispatch newsletter-track-click newsletter-track-open newsletter-subscribe process-email-queue auth-email-hook
```

`newsletter-track-click` e `newsletter-track-open` vanno ridistribuite ma **non vanno rimosse**: le email già spedite contengono i vecchi URL su dominio Supabase e devono continuare a funzionare.

Le route Vercel non richiedono nuove variabili d'ambiente: `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` sono già configurate in produzione (verificato con `vercel env ls`), e `PUBLIC_SITE_URL` ha un default su `https://biteproject.it`.

Verifiche post-deploy:

```sql
select jobname, schedule, active from cron.job where jobname in ('newsletter-dispatch','purge-expired-rate-limits');
```

e un invio di prova con controllo, nel sorgente del messaggio ricevuto, della presenza di `List-Unsubscribe` e `List-Unsubscribe-Post` (in Gmail deve comparire "Annulla iscrizione" accanto al mittente).

> Nota a margine: `apps/web/supabase/config.toml` contiene `project_id = "vdflrzcmlipvtardannd"`, mentre la CLI è collegata a `ekwloweuicrqjjgabfdp` (BITEProject.it) — che è anche il progetto nel fallback di `invoke_email_queue_worker()` e in `AGENTS.md`. Il valore in `config.toml` sembra semplicemente vecchio, ma va corretto prima che induca qualcuno in errore.

---

## 5. Azioni che richiedono l'intervento umano

1. **Decidere il disallineamento migrazioni della §4** e lanciare push e deploy: è il passaggio bloccante che tiene tutto il lavoro della Fase 1 fuori dalla produzione.
2. **Eseguire le query della Fase 0** su produzione (l'agente non ha permessi SQL sul progetto Supabase) e riportarne l'esito: da lì dipende la gravità reale di B2, B3 e della questione RLS.
3. **Configurare in Resend** il webhook degli eventi di bounce/complaint verso l'endpoint di soppressione, se non già attivo, e verificare l'allineamento SPF/DKIM/DMARC su `mail.biteproject.it`.
4. **Fornire un indirizzo postale** e la ragione sociale da inserire nel footer delle email.
5. **Confermare la soglia di invio attesa** (quanti iscritti oggi, quanti previsti a 12 mesi): decide se la Fase 2 è urgente o rinviabile.
