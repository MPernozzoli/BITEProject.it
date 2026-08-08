import { Link } from "react-router-dom";
import LegalPageShell, { LegalSection } from "@/components/legal/LegalPageShell";
import { useI18n } from "@/lib/i18n";

const Terms = () => {
  const { lang } = useI18n();
  const isIt = lang === "it";

  return (
    <LegalPageShell
      eyebrow={isIt ? "Termini e Condizioni" : "Terms and Conditions"}
      title={isIt ? "Termini d'uso" : "Terms of Use"}
      intro={
        isIt
          ? "Questi Termini regolano l'uso di biteproject.it, la registrazione di un account, la partecipazione alla community e la partecipazione ai viaggi condivisi organizzati nell'ambito del progetto BITE. Prima di registrarti o richiedere di partecipare a un viaggio ti chiediamo di leggerli con attenzione: descrivono la natura non commerciale del progetto, i tuoi obblighi e i limiti di responsabilità."
          : "These Terms govern the use of biteproject.it, account registration, participation in the community, and participation in the shared voyages organized within the BITE project. Before you register or request to join a voyage, please read them carefully: they describe the non-commercial nature of the project, your obligations, and the limits of liability."
      }
      lastUpdated={isIt ? "Ultimo aggiornamento: 8 agosto 2026" : "Last updated: August 8, 2026"}
    >
      <LegalSection title={isIt ? "Natura del progetto BITE" : "Nature of the BITE Project"}>
        <p>
          {isIt
            ? "BITE è un progetto editoriale e una community di persone appassionate di mare e navigazione. BITE non è un'agenzia di viaggi, un tour operator, un vettore né un'impresa che eroga servizi di trasporto o di ospitalità a titolo professionale."
            : "BITE is an editorial project and a community of people passionate about the sea and sailing. BITE is not a travel agency, a tour operator, a carrier, or a business providing transport or hospitality services on a professional basis."}
        </p>
        <p>
          {isIt
            ? "I viaggi presentati sul sito non sono pacchetti turistici né prestazioni di servizio vendute a un prezzo. Sono viaggi condivisi tra persone che partecipano insieme a un'esperienza di navigazione e ne dividono le spese vive. La partecipazione non genera profitto per gli organizzatori: ciò che i partecipanti versano è unicamente un contributo alle spese effettivamente sostenute per il viaggio."
            : "The voyages presented on the site are not travel packages nor services sold at a price. They are voyages shared among people who take part together in a sailing experience and split its actual costs. Participation generates no profit for the organizers: what participants pay is solely a contribution towards the costs actually incurred for the voyage."}
        </p>
        <p>
          {isIt
            ? "Chi conduce l'imbarcazione e chi coordina il viaggio partecipa anch'esso all'esperienza e non agisce come professionista del turismo o del trasporto. Il progetto non svolge, tramite queste iniziative, attività commerciale."
            : "Whoever skippers the boat and coordinates the voyage also takes part in the experience and does not act as a tourism or transport professional. Through these initiatives the project does not carry out commercial activity."}
        </p>
      </LegalSection>

      <LegalSection title={isIt ? "Accettazione dei Termini" : "Acceptance of the Terms"}>
        <p>
          {isIt
            ? "Utilizzando il sito, registrando un account o inviando una richiesta di partecipazione a un viaggio, dichiari di aver letto, compreso e accettato questi Termini. Se non li accetti, ti chiediamo di non registrarti e di non richiedere la partecipazione ai viaggi."
            : "By using the site, registering an account, or submitting a request to join a voyage, you declare that you have read, understood, and accepted these Terms. If you do not accept them, please do not register and do not request to join the voyages."}
        </p>
        <p>
          {isIt
            ? "Alcune sezioni pubbliche del sito sono consultabili senza registrazione. Le funzioni di community, la partecipazione ai viaggi e i pagamenti del contributo spese richiedono invece un account e l'accettazione di questi Termini."
            : "Some public sections of the site can be viewed without registration. Community features, voyage participation, and shared-cost contribution payments instead require an account and acceptance of these Terms."}
        </p>
      </LegalSection>

      <LegalSection title={isIt ? "Registrazione e account" : "Registration and Account"}>
        <ul className="space-y-3 list-disc pl-5">
          <li>
            {isIt
              ? "Per creare un account devi avere almeno 18 anni e la capacità di assumere obbligazioni giuridicamente vincolanti."
              : "To create an account you must be at least 18 years old and legally able to enter into binding obligations."}
          </li>
          <li>
            {isIt
              ? "La registrazione avviene tramite email o tramite login Google. Ti impegni a fornire dati veritieri, aggiornati e completi e a mantenerli aggiornati."
              : "Registration is done via email or Google login. You agree to provide truthful, current, and complete information and to keep it up to date."}
          </li>
          <li>
            {isIt
              ? "L'account è personale. Sei responsabile della riservatezza delle tue credenziali e di ogni attività svolta tramite il tuo account. Avvisaci tempestivamente in caso di uso non autorizzato."
              : "The account is personal. You are responsible for keeping your credentials confidential and for any activity carried out through your account. Notify us promptly of any unauthorized use."}
          </li>
          <li>
            {isIt
              ? "Puoi chiedere in ogni momento la cancellazione dell'account. Possiamo sospendere o chiudere un account in caso di violazione di questi Termini, di uso illecito o abusivo, o per esigenze di sicurezza del progetto e degli altri partecipanti."
              : "You may request deletion of your account at any time. We may suspend or close an account in case of breach of these Terms, unlawful or abusive use, or for the security of the project and other participants."}
          </li>
        </ul>
      </LegalSection>

      <LegalSection title={isIt ? "Community e contenuti degli utenti" : "Community and User Content"}>
        <p>
          {isIt
            ? "Se pubblichi commenti, risposte o altri contenuti nella community, resti responsabile di ciò che pubblichi e garantisci di averne il diritto. Ti impegni a non pubblicare contenuti illeciti, offensivi, diffamatori, che violino diritti altrui o la riservatezza di altre persone."
            : "If you post comments, replies, or other content in the community, you remain responsible for what you post and warrant that you have the right to do so. You agree not to publish unlawful, offensive, defamatory content, or content that infringes the rights or privacy of others."}
        </p>
        <p>
          {isIt
            ? "Nome profilo, avatar e contenuti pubblicati nella community possono essere visibili pubblicamente. Possiamo rimuovere contenuti che riteniamo in violazione di questi Termini o della legge. Concedi al progetto una licenza non esclusiva e gratuita per mostrare i contenuti che pubblichi nell'ambito del funzionamento del sito e della community."
            : "Your profile name, avatar, and content posted in the community may be publicly visible. We may remove content we consider in breach of these Terms or the law. You grant the project a non-exclusive, royalty-free license to display the content you post as part of operating the site and community."}
        </p>
      </LegalSection>

      <LegalSection title={isIt ? "Come funziona la partecipazione ai viaggi" : "How Voyage Participation Works"}>
        <ul className="space-y-3 list-disc pl-5">
          <li>
            {isIt
              ? "La partecipazione a un viaggio inizia con una richiesta: selezioni il viaggio e le eventuali tratte, indichi il numero di partecipanti e puoi aggiungere un messaggio o note."
              : "Participation in a voyage begins with a request: you select the voyage and any legs, indicate the number of participants, and may add a message or notes."}
          </li>
          <li>
            {isIt
              ? "La richiesta non è automaticamente confermata. Viene esaminata dai referenti del progetto, che possono accettarla, rifiutarla o chiedere chiarimenti, anche in base alla disponibilità di posti e alla compatibilità con il viaggio."
              : "The request is not automatically confirmed. It is reviewed by the project's leads, who may accept it, decline it, or ask for clarification, also based on available spots and compatibility with the voyage."}
          </li>
          <li>
            {isIt
              ? "Puoi invitare altri partecipanti alla tua richiesta; l'invitato riceve un invito e i suoi dati vengono trattati come descritto nella Privacy Policy. Sei responsabile di invitare solo persone che hanno acconsentito a partecipare."
              : "You may invite other participants to your request; the invitee receives an invitation and their data is processed as described in the Privacy Policy. You are responsible for inviting only people who have agreed to take part."}
          </li>
          <li>
            {isIt
              ? "Prima della partenza possono esserti richieste alcune attività preparatorie (task pre-partenza) e possono essere comunicate modifiche al piano di viaggio, che dovrai eventualmente approvare."
              : "Before departure you may be asked to complete some preparatory activities (pre-departure tasks), and changes to the voyage plan may be communicated, which you may need to approve."}
          </li>
        </ul>
      </LegalSection>

      <LegalSection title={isIt ? "Modifiche al viaggio, meteo e sicurezza" : "Voyage Changes, Weather, and Safety"}>
        <p>
          {isIt
            ? "I viaggi si svolgono in mare e dipendono dalle condizioni meteomarine. Date, orari, porti di partenza e di arrivo, tappe e itinerario indicati sono sempre orientativi e possono subire modifiche, anche repentine e a viaggio già iniziato."
            : "Voyages take place at sea and depend on sea and weather conditions. The indicated dates, times, departure and arrival ports, stops, and itinerary are always indicative and may change, even suddenly and once the voyage has already begun."}
        </p>
        <p>
          {isIt
            ? "Il criterio che guida ogni decisione è la sicurezza dell'equipaggio e dell'imbarcazione. Per tutelarla, chi conduce l'imbarcazione può, a proprio insindacabile giudizio, modificare la rotta, cambiare le date, scegliere porti diversi, anticipare o posticipare le tappe, sospendere o annullare il viaggio. Tali decisioni prevalgono su qualsiasi programma indicato in precedenza."
            : "The criterion guiding every decision is the safety of the crew and the boat. To protect it, whoever skippers the boat may, at their sole discretion, change the route, change the dates, choose different ports, bring stops forward or postpone them, suspend or cancel the voyage. Such decisions prevail over any previously indicated program."}
        </p>
        <p>
          {isIt
            ? "Le modifiche adottate per ragioni di sicurezza, meteo o forza maggiore non costituiscono inadempimento e non danno di per sé diritto a rimborsi ulteriori rispetto a quanto previsto dalla sezione sulle cancellazioni. Partecipando accetti questa flessibilità come parte della natura dell'esperienza in mare."
            : "Changes adopted for safety, weather, or force majeure reasons do not constitute a breach and do not in themselves give a right to refunds beyond what is provided in the cancellations section. By taking part you accept this flexibility as part of the nature of the experience at sea."}
        </p>
        <p>
          {isIt
            ? "I costi per raggiungere il luogo di partenza e per rientrare dal luogo di arrivo restano sempre a carico del singolo partecipante, così come eventuali spese di alloggio, vitto e trasporto sostenute in attesa dell'imbarco o a seguito di un cambio di programma. Questo vale anche in caso di modifica repentina del viaggio: se, ad esempio, l'imbarco slitta e devi pernottare in attesa, oppure se raggiungi la località inizialmente prevista ma il punto di ritrovo viene spostato in un'altra località, le spese per adeguarti restano a tuo carico."
            : "The costs of reaching the departure point and returning from the arrival point always remain the responsibility of each participant, as do any accommodation, meals, and transport expenses incurred while waiting to board or following a change of plan. This also applies in case of a sudden change to the voyage: if, for example, boarding is delayed and you need to stay overnight while waiting, or if you reach the initially planned location but the meeting point is moved to another one, the costs of adjusting remain your responsibility."}
        </p>
      </LegalSection>

      <LegalSection title={isIt ? "Contributo alle spese" : "Shared-Cost Contribution"}>
        <p>
          {isIt
            ? "L'importo indicato per un viaggio è una stima del contributo pro-capite alle spese comuni dell'imbarcazione (ad esempio ormeggi, carburante, spese portuali e altri costi condivisi di bordo). Non è un prezzo, un corrispettivo o una tariffa per un servizio: è la quota con cui ciascun partecipante contribuisce alle spese condivise."
            : "The amount shown for a voyage is an estimate of the per-person contribution towards the boat's common expenses (for example moorings, fuel, port fees, and other shared onboard costs). It is not a price, a fee, or a tariff for a service: it is the share with which each participant contributes to the shared expenses."}
        </p>
        <p>
          {isIt
            ? "Il contributo NON comprende le spese personali e alimentari, i biglietti e i costi delle attività che scegli di svolgere durante il viaggio (ad esempio immersioni, tour guidati, ingressi a musei, ristoranti ed escursioni). Tali spese restano a carico di ciascun partecipante."
            : "The contribution does NOT include personal and food expenses, tickets, or the costs of activities you choose to do during the voyage (for example diving, guided tours, museum entries, restaurants, and excursions). Such expenses remain the responsibility of each participant."}
        </p>
        <p>
          {isIt
            ? "La gestione della cambusa (i viveri di bordo) viene concordata di volta in volta tra i partecipanti; di norma la spesa viene divisa pro-capite utilizzando strumenti di ripartizione condivisa come Tricount o Splitwise, al di fuori del contributo indicato sul sito."
            : "Galley management (onboard provisions) is agreed case by case among participants; the cost is usually split per person using shared expense-splitting tools such as Tricount or Splitwise, separately from the contribution shown on the site."}
        </p>
        <p>
          {isIt
            ? "Il contributo può essere versato tramite pagamento online (Bunq) o bonifico bancario, secondo le modalità indicate al momento della richiesta. Il contributo è determinato in via forfettaria come quota delle spese comuni e, di norma, non è soggetto a conguaglio: non viene ricalcolato al termine del viaggio, né in aumento né in diminuzione. Solo in via eccezionale, in caso di variazioni rilevanti e imprevedibili delle spese comuni, i partecipanti potranno concordare tra loro un adeguamento; nessun conguaglio è dovuto in modo automatico."
            : "The contribution can be paid via online payment (Bunq) or bank transfer, according to the methods indicated at the time of the request. The contribution is set as a flat share of the common expenses and is generally not subject to settlement: it is not recalculated at the end of the voyage, either upward or downward. Only exceptionally, in case of significant and unforeseeable changes in the common expenses, participants may agree among themselves on an adjustment; no settlement is due automatically."}
        </p>
        <p>
          {isIt
            ? "Il versamento avviene in due fasi. Al momento della richiesta è dovuto un acconto pari al 50% del contributo, con un massimo di € 499,00 (in modo da restare sempre versabile anche con carta tramite il link di pagamento Bunq). La parte restante (il saldo) va versata entro 15 giorni prima della partenza della tua tratta di imbarco: se hai selezionato più tratte o ti imbarchi in un porto diverso da quello di partenza del viaggio, il termine si calcola sulla partenza della tua tratta, non su quella del viaggio nel suo complesso."
            : "Payment happens in two steps. At the time of the request, a deposit equal to 50% of the contribution is due, capped at €499.00 (so it always stays payable by card through the Bunq payment link too). The remaining part (the balance) is due within 15 days before the departure of your own embarkation leg: if you selected multiple legs, or you board at a port other than the voyage's overall starting point, the deadline is calculated on your own leg's departure, not on the voyage's departure as a whole."}
        </p>
        <p>
          {isIt
            ? "Se il saldo non viene versato entro questo termine, la prenotazione decade automaticamente (o, per i gruppi con pagamento individuale, decade la singola partecipazione di chi non ha versato, mentre il resto del gruppo resta confermato) e l'acconto versato non viene rimborsato, salvo una diversa valutazione discrezionale da parte nostra. Questa decadenza per mancato pagamento è distinta dalla rinuncia volontaria e dalle relative percentuali di rimborso indicate nella sezione «Cancellazioni e rimborsi»."
            : "If the balance is not paid by this deadline, the booking automatically lapses (or, for groups with individual payment, only the participation of whoever did not pay lapses, while the rest of the group stays confirmed) and the deposit paid is not refunded, unless we decide otherwise at our discretion. This lapse for non-payment is distinct from voluntary withdrawal and the related refund percentages set out in the “Cancellations and Refunds” section."}
        </p>
        <p>
          {isIt
            ? "BITE non conserva credenziali bancarie né dati completi delle carte di pagamento. I pagamenti online sono gestiti dal fornitore Bunq secondo i suoi termini."
            : "BITE does not store banking credentials or full payment card data. Online payments are handled by the provider Bunq under its own terms."}
        </p>
      </LegalSection>

      <LegalSection title={isIt ? "Cancellazioni e rimborsi" : "Cancellations and Refunds"}>
        <p>
          {isIt
            ? "Poiché il contributo serve a coprire spese comuni che vengono impegnate in anticipo, il rimborso in caso di rinuncia è calcolato in funzione di quanto manca alla partenza, secondo la seguente policy applicata dal sistema:"
            : "Since the contribution is used to cover common expenses committed in advance, the refund in case of withdrawal is calculated based on how far it is from departure, according to the following policy applied by the system:"}
        </p>
        <ul className="space-y-3 list-disc pl-5">
          <li>
            {isIt
              ? "Rinuncia più di 30 giorni prima della partenza: rimborso del 100% del contributo versato."
              : "Withdrawal more than 30 days before departure: 100% of the contribution paid is refunded."}
          </li>
          <li>
            {isIt
              ? "Rinuncia tra 15 e 30 giorni prima della partenza: rimborso del 50% del contributo versato."
              : "Withdrawal between 15 and 30 days before departure: 50% of the contribution paid is refunded."}
          </li>
          <li>
            {isIt
              ? "Rinuncia meno di 15 giorni prima della partenza: nessun rimborso, in quanto le spese comuni risultano ormai impegnate."
              : "Withdrawal less than 15 days before departure: no refund, as the common expenses are by then already committed."}
          </li>
        </ul>
        <p>
          {isIt
            ? "Il rimborso, quando previsto, viene disposto verso il metodo di pagamento o l'IBAN utilizzato. Se non è disponibile un IBAN o un riferimento valido per il rimborso, l'importo dovuto resta in sospeso finché non ci fornisci le coordinate necessarie."
            : "The refund, where applicable, is issued to the payment method or IBAN used. If no IBAN or valid refund reference is available, the amount owed remains pending until you provide the necessary details."}
        </p>
        <p>
          {isIt
            ? "Queste percentuali si applicano alla rinuncia volontaria e ai casi assimilati sopra descritti. Sono invece disciplinati separatamente, nella sezione «Contributo alle spese», i casi di decadenza per mancato versamento del saldo entro la scadenza indicata: in quel caso l'acconto non è rimborsato, salvo nostra diversa valutazione discrezionale."
            : "These percentages apply to voluntary withdrawal and the related cases described above. Cases of lapse for failing to pay the balance by the indicated deadline are instead governed separately, in the “Shared-Cost Contribution” section: in that case the deposit is not refunded, unless we decide otherwise at our discretion."}
        </p>
        <p>
          {isIt
            ? "Modifiche e annullamenti da parte nostra. Se proponiamo una modifica sostanziale al piano di viaggio per ragioni di forza maggiore (meteo, sicurezza e simili, come descritto nella sezione «Modifiche al viaggio, meteo e sicurezza») e non la accetti, si applicano le stesse percentuali previste per la rinuncia: 100% oltre 30 giorni dalla partenza, 50% tra 15 e 30 giorni, nessun rimborso sotto i 15 giorni."
            : "Changes and cancellations by us. If we propose a substantial change to the voyage plan for reasons of force majeure (weather, safety, and the like, as described in the “Voyage Changes, Weather, and Safety” section) and you do not accept it, the same percentages as for withdrawal apply: 100% more than 30 days before departure, 50% between 15 and 30 days, no refund under 15 days."}
        </p>
        <p>
          {isIt
            ? "Se invece la modifica dipende da ragioni diverse dalla forza maggiore (ad esempio questioni organizzative nostre) ed essa non ti consente di partecipare, è sempre previsto il rimborso completo di quanto versato."
            : "If instead the change depends on reasons other than force majeure (for example our own organizational matters) and it prevents you from taking part, a full refund of what you paid is always provided."}
        </p>
        <p>
          {isIt
            ? "In caso di annullamento totale del viaggio da parte nostra, o di sospensione delle tratte future, è previsto il rimborso completo di quanto versato, dedotte le eventuali quote attribuibili a tratte già effettuate, ove applicabile."
            : "In case of full cancellation of the voyage by us, or suspension of future legs, a full refund of what you paid is provided, less any shares attributable to legs already completed, where applicable."}
        </p>
        <p>
          {isIt
            ? "I viaggi non vengono annullati per numero insufficiente di partecipanti: trattandosi di un viaggio condiviso e non di un servizio commerciale, viaggiamo comunque, anche in pochi o da soli."
            : "Voyages are not cancelled due to an insufficient number of participants: since this is a shared voyage and not a commercial service, we travel anyway, even few or alone."}
        </p>
      </LegalSection>

      <LegalSection title={isIt ? "Rischi, sicurezza e responsabilità dei partecipanti" : "Risks, Safety, and Participant Responsibility"}>
        <p>
          {isIt
            ? "La navigazione comporta rischi intrinseci. Partecipando a un viaggio dichiari di esserne consapevole e di prendervi parte volontariamente, valutando in autonomia la tua idoneità fisica e la tua esperienza."
            : "Sailing involves inherent risks. By taking part in a voyage you acknowledge that you are aware of them and that you take part voluntarily, assessing your own physical fitness and experience."}
        </p>
        <ul className="space-y-3 list-disc pl-5">
          <li>
            {isIt
              ? "Sei responsabile di avere con te i documenti validi necessari, eventuali requisiti sanitari e una copertura assicurativa personale adeguata (inclusa, ove opportuno, l'assistenza in viaggio e l'annullamento). Il progetto non fornisce coperture assicurative per i partecipanti."
              : "You are responsible for carrying the necessary valid documents, any health requirements, and adequate personal insurance coverage (including, where appropriate, travel assistance and cancellation). The project does not provide insurance coverage for participants."}
          </li>
          <li>
            {isIt
              ? "A bordo sei tenuto a seguire le istruzioni di sicurezza e le indicazioni di chi conduce l'imbarcazione, incluse quelle relative a rotta, tappe e orari (vedi la sezione «Modifiche al viaggio, meteo e sicurezza»)."
              : "On board you must follow the safety instructions and the directions of whoever skippers the boat, including those regarding route, stops, and timing (see the section “Voyage Changes, Weather, and Safety”)."}
          </li>
          <li>
            {isIt
              ? "Rispondi dei danni che causi per dolo o colpa a persone, all'imbarcazione o a beni di terzi durante il viaggio."
              : "You are liable for damage you cause, intentionally or negligently, to people, the boat, or third-party property during the voyage."}
          </li>
        </ul>
      </LegalSection>

      <LegalSection title={isIt ? "Limitazione di responsabilità" : "Limitation of Liability"}>
        <p>
          {isIt
            ? "Considerata la natura non commerciale e condivisa dei viaggi, gli organizzatori e i referenti del progetto non assumono gli obblighi propri di un vettore o di un organizzatore professionale di viaggi. Nei limiti consentiti dalla legge, la loro responsabilità è esclusa per i rischi tipici della navigazione e per gli eventi non imputabili a dolo o colpa grave."
            : "Given the non-commercial and shared nature of the voyages, the organizers and project leads do not assume the obligations of a carrier or a professional travel organizer. To the extent permitted by law, their liability is excluded for the typical risks of sailing and for events not attributable to intent or gross negligence."}
        </p>
        <p>
          {isIt
            ? "Nulla in questi Termini esclude o limita la responsabilità che non può essere esclusa o limitata per legge, in particolare in caso di dolo, colpa grave o danni alla persona ove la legge non ne consenta l'esclusione. Il sito e i suoi contenuti sono forniti \"così come sono\", senza garanzie di continuità o assenza di errori."
            : "Nothing in these Terms excludes or limits liability that cannot be excluded or limited by law, in particular in case of intent, gross negligence, or personal injury where the law does not allow exclusion. The site and its content are provided \"as is\", without warranties of continuity or absence of errors."}
        </p>
      </LegalSection>

      <LegalSection title={isIt ? "Forza maggiore" : "Force Majeure"}>
        <p>
          {isIt
            ? "Nessuna delle parti è responsabile per il mancato o ritardato adempimento dovuto a eventi al di fuori del ragionevole controllo, tra cui condizioni meteomarine avverse, provvedimenti delle autorità, emergenze sanitarie, guasti tecnici o altre cause di forza maggiore."
            : "Neither party is liable for failure or delay in performance due to events beyond reasonable control, including adverse sea and weather conditions, measures by authorities, health emergencies, technical failures, or other causes of force majeure."}
        </p>
      </LegalSection>

      <LegalSection title={isIt ? "Proprietà intellettuale" : "Intellectual Property"}>
        <p>
          {isIt
            ? "I testi, le immagini, il logo, la grafica e gli altri contenuti del sito prodotti dal progetto sono protetti e non possono essere riprodotti o riutilizzati senza autorizzazione, salvo quanto consentito dalla legge o esplicitamente indicato."
            : "The texts, images, logo, graphics, and other site content produced by the project are protected and may not be reproduced or reused without authorization, except as permitted by law or explicitly indicated."}
        </p>
      </LegalSection>

      <LegalSection title={isIt ? "Foto, riprese e registrazioni" : "Photos, Filming, and Recordings"}>
        <p>
          {isIt
            ? "BITE è anche un progetto editoriale che racconta i propri viaggi. Partecipando a un viaggio accetti di poter essere fotografato, ripreso e registrato durante l'esperienza, e autorizzi il progetto a conservare, montare e pubblicare tali contenuti — anche a titolo gratuito e senza limiti di tempo — sul sito, sulla newsletter, sui social e su tutte le altre piattaforme del progetto, nell'ambito del racconto delle attività di BITE."
            : "BITE is also an editorial project that documents its voyages. By taking part in a voyage you agree that you may be photographed, filmed, and recorded during the experience, and you authorize the project to store, edit, and publish such content — including free of charge and without time limits — on the site, newsletter, social media, and all other project platforms, as part of documenting BITE's activities."}
        </p>
        <p>
          {isIt
            ? "Se non desideri comparire nei contenuti pubblicati, o vuoi che un contenuto che ti riguarda venga rimosso, puoi comunicarcelo in qualsiasi momento scrivendo a hello@biteproject.com e faremo il possibile per rispettare la tua richiesta per le pubblicazioni successive."
            : "If you prefer not to appear in published content, or you want content concerning you to be removed, you can let us know at any time by writing to hello@biteproject.com, and we will do our best to honor your request for subsequent publications."}
        </p>
      </LegalSection>

      <LegalSection title={isIt ? "Protezione dei dati" : "Data Protection"}>
        <p>
          {isIt ? (
            <>
              Il trattamento dei dati personali raccolti tramite il sito, la registrazione, la community e la partecipazione ai viaggi è descritto nella{" "}
              <Link to="/privacy-policy" className="text-accent hover:text-foreground transition-colors">
                Privacy Policy
              </Link>
              . Per i cookie e gli strumenti tecnici consulta la{" "}
              <Link to="/cookie-policy" className="text-accent hover:text-foreground transition-colors">
                Cookie Policy
              </Link>
              .
            </>
          ) : (
            <>
              The processing of personal data collected through the site, registration, the community, and voyage participation is described in the{" "}
              <Link to="/privacy-policy" className="text-accent hover:text-foreground transition-colors">
                Privacy Policy
              </Link>
              . For cookies and technical tools see the{" "}
              <Link to="/cookie-policy" className="text-accent hover:text-foreground transition-colors">
                Cookie Policy
              </Link>
              .
            </>
          )}
        </p>
      </LegalSection>

      <LegalSection title={isIt ? "Modifiche ai Termini" : "Changes to the Terms"}>
        <p>
          {isIt
            ? "Possiamo aggiornare questi Termini per riflettere modifiche al funzionamento del sito, ai viaggi o alle previsioni di legge. La versione aggiornata è pubblicata su questa pagina con la relativa data. L'uso del sito successivo alla pubblicazione vale come accettazione delle modifiche."
            : "We may update these Terms to reflect changes to how the site or the voyages work, or to legal requirements. The updated version is published on this page with its date. Continued use of the site after publication constitutes acceptance of the changes."}
        </p>
      </LegalSection>

      <LegalSection title={isIt ? "Legge applicabile e foro competente" : "Governing Law and Jurisdiction"}>
        <p>
          {isIt
            ? "Questi Termini sono regolati dalla legge italiana. Per le controversie con i consumatori resta competente il foro del luogo di residenza o domicilio del consumatore, se situato in Italia, e restano fermi i diritti inderogabili riconosciuti dalla legge. È possibile ricorrere alla piattaforma europea di risoluzione online delle controversie (ODR)."
            : "These Terms are governed by Italian law. For disputes with consumers, the court of the consumer's place of residence or domicile in Italy remains competent where applicable, and mandatory rights granted by law remain unaffected. The European online dispute resolution (ODR) platform is available."}
        </p>
      </LegalSection>

      <LegalSection title={isIt ? "Contatti" : "Contact"}>
        <p>
          {isIt
            ? "Per qualsiasi domanda su questi Termini puoi scriverci all'indirizzo hello@biteproject.com."
            : "For any questions about these Terms you can write to us at hello@biteproject.com."}
        </p>
      </LegalSection>
    </LegalPageShell>
  );
};

export default Terms;
