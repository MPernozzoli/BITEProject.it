import { Link } from "react-router-dom";
import LegalPageShell, { LegalSection } from "@/components/legal/LegalPageShell";
import { useI18n } from "@/lib/i18n";

const PrivacyPolicy = () => {
  const { lang } = useI18n();
  const isIt = lang === "it";

  return (
    <LegalPageShell
      eyebrow={isIt ? "Protezione Dati" : "Data Protection"}
      title="Privacy Policy"
      intro={
        isIt
          ? "Questa informativa descrive come BITE tratta i dati personali raccolti tramite biteproject.it, la community collegata al logbook e i relativi servizi email. Il testo è stato aggiornato per riflettere le funzionalità presenti sul sito alla data del 28 marzo 2026."
          : "This notice explains how BITE processes personal data collected through biteproject.it, the logbook community area, and related email services. It has been updated to reflect the features currently present on the site as of March 28, 2026."
      }
      lastUpdated={isIt ? "Ultimo aggiornamento: 28 marzo 2026" : "Last updated: March 28, 2026"}
    >
      <LegalSection title={isIt ? "Titolare del trattamento" : "Data Controller"}>
        <p>
          {isIt
            ? "Il titolare del trattamento è BITE, progetto editoriale e community raggiungibile all'indirizzo email hello@biteproject.com."
            : "The data controller is BITE, the editorial project and community reachable at hello@biteproject.com."}
        </p>
        <p>
          {isIt
            ? "Per richieste relative a privacy, diritti degli interessati, cancellazione dati o opposizioni puoi scrivere a hello@biteproject.com."
            : "For privacy requests, data subject rights, deletion requests, or objections, you can write to hello@biteproject.com."}
        </p>
      </LegalSection>

      <LegalSection title={isIt ? "Quali dati trattiamo" : "What Data We Process"}>
        <ul className="space-y-3 list-disc pl-5">
          <li>
            {isIt
              ? "Dati di navigazione tecnica: indirizzo IP, user agent, log di richiesta, identificatori tecnici di sicurezza e dati strettamente necessari al funzionamento del sito e della CDN."
              : "Technical browsing data: IP address, user agent, request logs, technical security identifiers, and data strictly needed to operate the site and CDN."}
          </li>
          <li>
            {isIt
              ? "Dati account e profilo: email, nome visualizzato, preferenze lingua, avatar e link social o sito personale se li inserisci nel tuo profilo."
              : "Account and profile data: email, display name, language preferences, avatar, and social or website links if you add them to your profile."}
          </li>
          <li>
            {isIt
              ? "Dati di community: commenti, risposte, like agli articoli, like ai commenti, iscrizioni alle storie e cronologia di lettura associata al tuo profilo quando sei autenticato."
              : "Community data: comments, replies, article likes, comment likes, story subscriptions, and read history associated with your profile when you are signed in."}
          </li>
          <li>
            {isIt
              ? "Dati di lettura tecnica: un identificatore locale del browser e il conteggio delle letture qualificate degli articoli per evitare conteggi gonfiati e migliorare la metrica interna del progetto."
              : "Technical read data: a local browser identifier and qualified article read counts used to avoid inflated counters and improve the project's internal metrics."}
          </li>
          <li>
            {isIt
              ? "Dati newsletter ed email: indirizzo email, lingua preferita, stato di iscrizione, token di disiscrizione e dati di consegna. Le email newsletter possono includere misurazioni tecniche di apertura e click."
              : "Newsletter and email data: email address, preferred language, subscription status, unsubscribe tokens, and delivery data. Newsletter emails may include technical open and click measurement."}
          </li>
          <li>
            {isIt
              ? "Dati che ci invii volontariamente scrivendoci via email."
              : "Data you voluntarily send when you contact us by email."}
          </li>
        </ul>
      </LegalSection>

      <LegalSection title={isIt ? "Finalità e basi giuridiche" : "Purposes and Legal Bases"}>
        <ul className="space-y-3 list-disc pl-5">
          <li>
            {isIt
              ? "Erogazione del sito, sicurezza, prevenzione abusi e continuità operativa: legittimo interesse del titolare e necessità tecnica del servizio (art. 6, par. 1, lett. f GDPR)."
              : "Site delivery, security, abuse prevention, and service continuity: controller's legitimate interest and technical necessity of the service (Art. 6(1)(f) GDPR)."}
          </li>
          <li>
            {isIt
              ? "Creazione e gestione dell'account, autenticazione via email o Google, profilo pubblico, commenti, like e iscrizioni alle storie: esecuzione di misure precontrattuali o di un servizio richiesto dall'utente (art. 6, par. 1, lett. b GDPR)."
              : "Account creation and management, email or Google sign-in, public profile, comments, likes, and story subscriptions: performance of pre-contractual measures or a service requested by the user (Art. 6(1)(b) GDPR)."}
          </li>
          <li>
            {isIt
              ? "Invio newsletter e comunicazioni periodiche: consenso dell'interessato, revocabile in ogni momento (art. 6, par. 1, lett. a GDPR)."
              : "Newsletter and periodic communications: the data subject's consent, withdrawable at any time (Art. 6(1)(a) GDPR)."}
          </li>
          <li>
            {isIt
              ? "Gestione disiscrizioni, soppressioni email, adempimenti normativi e difesa dei diritti del titolare: obbligo legale e legittimo interesse (art. 6, par. 1, lett. c e f GDPR)."
              : "Handling unsubscribes, email suppression, legal compliance, and protection of the controller's rights: legal obligation and legitimate interest (Art. 6(1)(c) and (f) GDPR)."}
          </li>
        </ul>
      </LegalSection>

      <LegalSection title={isIt ? "Natura del conferimento" : "Whether Data Provision Is Mandatory"}>
        <p>
          {isIt
            ? "La navigazione ordinaria del sito richiede solo i dati tecnici minimi. La creazione di un account, la pubblicazione di commenti, l'iscrizione alla newsletter o a una storia, e l'uso del login Google richiedono invece il conferimento dei dati necessari a quella specifica funzione."
            : "Ordinary browsing only requires minimal technical data. Creating an account, posting comments, subscribing to the newsletter or to a story, and using Google login instead require the data needed for that specific feature."}
        </p>
        <p>
          {isIt
            ? "Se non fornisci questi dati, potrai comunque consultare le parti pubbliche del sito ma non utilizzare le funzioni che li richiedono."
            : "If you do not provide that data, you may still browse the public areas of the site but you will not be able to use the features that depend on it."}
        </p>
      </LegalSection>

      <LegalSection title={isIt ? "Visibilità pubblica dei contenuti" : "Public Visibility of Content"}>
        <p>
          {isIt
            ? "Nome profilo, avatar, commenti e altri contenuti che pubblichi nella community possono essere visibili pubblicamente ad altri utenti e visitatori. Ti chiediamo quindi di non inserire nei campi pubblici dati che non vuoi rendere conoscibili."
            : "Your profile name, avatar, comments, and other content you publish in the community may be visible to other users and visitors. For that reason, do not enter data in public fields that you do not want to disclose."}
        </p>
      </LegalSection>

      <LegalSection title={isIt ? "Tempi di conservazione" : "Retention Periods"}>
        <ul className="space-y-3 list-disc pl-5">
          <li>
            {isIt
              ? "Dati tecnici di sicurezza e continuità operativa: per il tempo strettamente necessario alla gestione del servizio, della sicurezza e di eventuali incidenti."
              : "Technical security and continuity data: for the time strictly necessary to manage the service, security, and any incidents."}
          </li>
          <li>
            {isIt
              ? "Dati account e profilo: fino alla cancellazione dell'account o alla richiesta di rimozione, salvo obblighi di conservazione ulteriori."
              : "Account and profile data: until account deletion or a removal request, unless longer retention is required by law."}
          </li>
          <li>
            {isIt
              ? "Commenti, like e interazioni community: finché restano pubblicati o finché ne chiedi la rimozione, fatti salvi obblighi di tutela del sistema e difesa."
              : "Comments, likes, and community interactions: as long as they remain published or until you request removal, without prejudice to system protection and legal defense needs."}
          </li>
          <li>
            {isIt
              ? "Newsletter: fino alla revoca del consenso o alla disiscrizione; i dati minimi di soppressione possono essere conservati per evitare invii indesiderati successivi."
              : "Newsletter: until consent is withdrawn or you unsubscribe; minimal suppression data may be retained to avoid future unwanted messages."}
          </li>
          <li>
            {isIt
              ? "Identificatore locale di lettura: resta nel browser finché non cancelli i dati del sito."
              : "Local read identifier: it remains in your browser until you clear the site's stored data."}
          </li>
        </ul>
      </LegalSection>

      <LegalSection title={isIt ? "Destinatari e responsabili" : "Recipients and Processors"}>
        <p>
          {isIt
            ? "I dati possono essere trattati, per quanto necessario, da fornitori che supportano l'operatività del sito e agiscono come responsabili o autonomi titolari a seconda del ruolo svolto. In particolare:"
            : "Data may be processed, where necessary, by providers supporting the operation of the site, acting either as processors or independent controllers depending on their role. In particular:"}
        </p>
        <ul className="space-y-3 list-disc pl-5">
          <li>
            {isIt
              ? "Cloudflare (hosting edge, sicurezza, CDN)"
              : "Cloudflare (edge hosting, security, CDN)"}
          </li>
          <li>
            {isIt
              ? "Supabase (database, autenticazione, storage, funzioni applicative)"
              : "Supabase (database, authentication, storage, application functions)"}
          </li>
          <li>
            {isIt
              ? "Google, solo se scegli il login Google o interagisci con servizi YouTube"
              : "Google, only if you choose Google login or interact with YouTube services"}
          </li>
          <li>
            {isIt
              ? "CARTO/OpenStreetMap, quando carichi pagine con mappe"
              : "CARTO/OpenStreetMap, when you load pages with maps"}
          </li>
          <li>
            {isIt
              ? "fornitori email e infrastruttura di invio per messaggi transazionali e newsletter"
              : "email delivery and messaging infrastructure providers for transactional messages and newsletters"}
          </li>
        </ul>
      </LegalSection>

      <LegalSection title={isIt ? "Trasferimenti extra SEE" : "Transfers Outside the EEA"}>
        <p>
          {isIt
            ? "Alcuni fornitori tecnici usati dal sito possono trattare dati al di fuori dello Spazio Economico Europeo. Quando ciò accade, il trattamento avviene sulla base di strumenti previsti dal GDPR, come decisioni di adeguatezza, clausole contrattuali standard o altre garanzie appropriate predisposte dal fornitore."
            : "Some technical providers used by the site may process data outside the European Economic Area. Where that happens, processing relies on GDPR transfer mechanisms such as adequacy decisions, standard contractual clauses, or other appropriate safeguards implemented by the provider."}
        </p>
      </LegalSection>

      <LegalSection title={isIt ? "Diritti dell'interessato" : "Your Rights"}>
        <p>
          {isIt
            ? "Nei casi previsti dal GDPR puoi chiedere accesso, rettifica, cancellazione, limitazione, portabilità dei dati e opporti al trattamento. Puoi inoltre revocare in ogni momento i consensi eventualmente prestati, senza pregiudicare la liceità del trattamento effettuato prima della revoca."
            : "Where provided by the GDPR, you may request access, rectification, erasure, restriction, portability, and you may object to processing. You may also withdraw any consent at any time without affecting the lawfulness of processing carried out before the withdrawal."}
        </p>
        <p>
          {isIt
            ? "Hai anche diritto di proporre reclamo al Garante per la protezione dei dati personali."
            : "You also have the right to lodge a complaint with the Italian Data Protection Authority."}
        </p>
      </LegalSection>

      <LegalSection title={isIt ? "Cookie e strumenti locali" : "Cookies and Local Technologies"}>
        <p>
          {isIt ? (
            <>
              Per il dettaglio su cookie, local storage e strumenti tecnici usati dal sito consulta la{" "}
              <Link to="/cookie-policy" className="text-accent hover:text-foreground transition-colors">
                Cookie Policy
              </Link>
              .
            </>
          ) : (
            <>
              For details about cookies, local storage, and the site's technical tools, see the{" "}
              <Link to="/cookie-policy" className="text-accent hover:text-foreground transition-colors">
                Cookie Policy
              </Link>
              .
            </>
          )}
        </p>
      </LegalSection>
    </LegalPageShell>
  );
};

export default PrivacyPolicy;
