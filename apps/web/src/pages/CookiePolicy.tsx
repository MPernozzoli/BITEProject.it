import { Link } from "react-router-dom";
import LegalPageShell, { LegalSection } from "@/components/legal/LegalPageShell";
import { useI18n } from "@/lib/i18n";

const CookiePolicy = () => {
  const { lang } = useI18n();
  const isIt = lang === "it";

  return (
    <LegalPageShell
      eyebrow={isIt ? "Cookie e Tecnologie Simili" : "Cookies and Similar Technologies"}
      title="Cookie Policy"
      intro={
        isIt
          ? "Questa Cookie Policy spiega cosa sono i cookie, quali categorie di strumenti usa BITE su biteproject.it e per quali finalità. Il sito utilizza esclusivamente cookie e strumenti simili necessari al funzionamento del servizio, alla sicurezza, all'autenticazione, alla partecipazione ai viaggi, ai pagamenti di contributo spese e ad alcune funzionalità richieste dall'utente."
          : "This Cookie Policy explains what cookies are, which categories of tools BITE uses on biteproject.it, and for which purposes. The site only uses cookies and similar technologies needed for service operation, security, authentication, voyage participation, shared-cost contribution payments, and user-requested features."
      }
      lastUpdated={isIt ? "Ultimo aggiornamento: 12 luglio 2026" : "Last updated: July 12, 2026"}
    >
      <LegalSection title={isIt ? "Cosa sono i cookie" : "What Cookies Are"}>
        <p>
          {isIt
            ? "I cookie sono piccoli file di testo che i siti web possono salvare sul dispositivo dell'utente durante la navigazione. Accanto ai cookie, un sito può usare anche tecnologie simili, come il local storage del browser, per ricordare impostazioni, mantenere una sessione attiva o far funzionare specifiche funzioni."
            : "Cookies are small text files that websites can store on a user's device while browsing. Alongside cookies, a site may also use similar technologies, such as browser local storage, to remember settings, keep a session active, or enable specific features."}
        </p>
      </LegalSection>

      <LegalSection title={isIt ? "Quali categorie utilizziamo" : "Which Categories We Use"}>
        <p>
          {isIt
            ? "BITE non utilizza cookie pubblicitari né cookie di profilazione per finalità commerciali. Il sito usa invece le seguenti categorie di strumenti tecnici:"
            : "BITE does not use advertising or profiling cookies for commercial targeting. The site instead uses the following categories of technical tools:"}
        </p>
        <ul className="space-y-3 list-disc pl-5">
          <li>
            {isIt
              ? "cookie e strumenti tecnici di sicurezza, necessari a proteggere il sito, prevenire abusi e garantire la continuità del servizio;"
              : "technical security cookies and tools needed to protect the site, prevent abuse, and ensure service continuity;"}
          </li>
          <li>
            {isIt
              ? "strumenti di autenticazione e mantenimento sessione, anche su cookie tecnici gestiti dal browser, necessari a consentire login, accesso all'area community, commenti, like, gestione del profilo, partecipazione ai viaggi e area prenotazioni;"
              : "authentication and session tools, including technical browser cookies, needed to enable sign-in, community access, comments, likes, profile management, voyage participation, and the bookings area;"}
          </li>
          <li>
            {isIt
              ? "strumenti tecnici di memoria locale, usati per funzioni richieste dall'utente, come preferenza lingua, gestione della sessione sul dispositivo, sincronizzazione temporanea delle preferenze newsletter e conteggio interno delle letture effettive degli articoli;"
              : "technical local storage tools used for features requested by the user, such as language preference, device session handling, temporary synchronization of newsletter preferences, and internal counting of actual article reads;"}
          </li>
          <li>
            {isIt
              ? "strumenti tecnici di prenotazione e pagamento, necessari a mantenere la richiesta di partecipazione, verificare lo stato del contributo spese, mostrare i dettagli di bonifico o reindirizzare verso il pagamento Bunq;"
              : "technical booking and payment tools needed to keep the participation request, verify shared-cost contribution status, show bank transfer details, or redirect to Bunq payment;"}
          </li>
          <li>
            {isIt
              ? "strumenti di interfaccia strettamente funzionali, come lo stato della sidebar o altre preferenze locali necessarie a mantenere coerente l'esperienza sul dispositivo;"
              : "strictly functional interface tools, such as sidebar state or other local preferences needed to keep the device experience consistent;"}
          </li>
          <li>
            {isIt
              ? "strumenti di Web Push, usati solo se abiliti le notifiche sul dispositivo e necessari a salvare la sottoscrizione del browser."
              : "Web Push tools, used only if you enable device notifications and needed to save the browser subscription."}
          </li>
          <li>
            {isIt
              ? "contenuti o servizi di terze parti caricati solo quando previsti dalla pagina o attivati dall'utente, come login Google, mappe e video YouTube."
              : "third-party content or services loaded only when required by the page or activated by the user, such as Google login, maps, and YouTube videos."}
          </li>
        </ul>
      </LegalSection>

      <LegalSection title={isIt ? "Finalità del trattamento tramite cookie e strumenti simili" : "Purposes of Cookies and Similar Technologies"}>
        <ul className="space-y-3 list-disc pl-5">
          <li>
            {isIt
              ? "garantire la sicurezza del sito e la protezione da traffico malevolo o automatizzato;"
              : "to ensure site security and protection against malicious or automated traffic;"}
          </li>
          <li>
            {isIt
              ? "mantenere la sessione dell'utente autenticato e permettere l'accesso alle funzioni riservate;"
              : "to keep authenticated users signed in and allow access to reserved features;"}
          </li>
          <li>
            {isIt
              ? "memorizzare scelte o preferenze strettamente tecniche relative all'uso del sito, inclusa la lingua e alcune preferenze di interfaccia;"
              : "to store choices or strictly technical preferences relating to site use, including language and some interface preferences;"}
          </li>
          <li>
            {isIt
              ? "abilitare il corretto funzionamento di commenti, like, profilo personale e altre funzioni della community;"
              : "to enable the correct functioning of comments, likes, personal profile features, and other community functions;"}
          </li>
          <li>
            {isIt
              ? "abilitare richieste di partecipazione ai viaggi, gestione degli invitati, accettazione o rifiuto degli inviti, task pre-partenza e area personale delle prenotazioni;"
              : "to enable voyage participation requests, invited participant management, invitation acceptance or decline, pre-departure tasks, and the personal bookings area;"}
          </li>
          <li>
            {isIt
              ? "creare, mostrare e verificare pagamenti del contributo spese tramite Bunq o bonifico, senza memorizzare credenziali bancarie nel browser;"
              : "to create, display, and verify shared-cost contribution payments through Bunq or bank transfer, without storing banking credentials in the browser;"}
          </li>
          <li>
            {isIt
              ? "registrare e gestire la sottoscrizione Web Push quando l'utente abilita le notifiche;"
              : "to register and manage the Web Push subscription when the user enables notifications;"}
          </li>
          <li>
            {isIt
              ? "misurare internamente le letture qualificate degli articoli senza ricorrere a sistemi pubblicitari di tracciamento."
              : "to internally measure qualified article reads without relying on advertising tracking systems."}
          </li>
        </ul>
      </LegalSection>

      <LegalSection title={isIt ? "Base giuridica" : "Legal Basis"}>
        <p>
          {isIt
            ? "L'uso di questi strumenti avviene per finalità strettamente necessarie al funzionamento del sito e all'erogazione di servizi richiesti dall'utente. Per tali strumenti tecnici non è richiesto un consenso preventivo separato. Se in futuro venissero introdotti cookie o strumenti non tecnici, il sito dovrà aggiornare questa policy e raccogliere il consenso quando richiesto dalla normativa applicabile."
            : "These tools are used for purposes strictly necessary for site operation and for delivering services requested by the user. No separate prior consent is required for such technical tools. If non-technical cookies or trackers are introduced in the future, the site will need to update this policy and collect consent whenever required by applicable law."}
        </p>
      </LegalSection>

      <LegalSection title={isIt ? "Terze parti coinvolte" : "Third Parties Involved"}>
        <p>
          {isIt
            ? "Per alcune funzioni il sito può avvalersi di fornitori terzi. In particolare:"
            : "Some site features may rely on third-party providers. In particular:"}
        </p>
        <ul className="space-y-3 list-disc pl-5">
          <li>
            {isIt
              ? "Cloudflare, per sicurezza, distribuzione dei contenuti e protezione dell'infrastruttura;"
              : "Cloudflare, for security, content delivery, and infrastructure protection;"}
          </li>
          <li>
            {isIt
              ? "Supabase, per autenticazione, sessione utente, database e storage dei contenuti;"
              : "Supabase, for authentication, user session management, database, and content storage;"}
          </li>
          <li>
            {isIt
              ? "Bunq, solo quando l'utente avvia o verifica un pagamento online del contributo spese;"
              : "Bunq, only when the user starts or verifies an online shared-cost contribution payment;"}
          </li>
          <li>
            {isIt
              ? "Google, solo se l'utente sceglie il login Google o interagisce con contenuti YouTube;"
              : "Google, only if the user chooses Google login or interacts with YouTube content;"}
          </li>
          <li>
            {isIt
              ? "CARTO e OpenStreetMap, per le funzionalità cartografiche presenti in alcune pagine;"
              : "CARTO and OpenStreetMap, for map features available on some pages;"}
          </li>
          <li>
            {isIt
              ? "servizi Web Push del browser o del sistema operativo, solo se abiliti le notifiche."
              : "browser or operating-system Web Push services, only if you enable notifications."}
          </li>
        </ul>
        <p>
          {isIt
            ? "I servizi di terze parti operano secondo le rispettive informative privacy e cookie, che l'utente può consultare sui relativi siti."
            : "Third-party services operate under their own privacy and cookie policies, which users can review on the relevant providers' websites."}
        </p>
      </LegalSection>

      <LegalSection title={isIt ? "Durata" : "Duration"}>
        <p>
            {isIt
            ? "I cookie e gli strumenti tecnici usati dal sito possono avere durata limitata alla sessione oppure durata persistente, in funzione della loro finalità. Gli strumenti di sicurezza hanno generalmente durata breve; gli strumenti di sessione restano attivi fino al logout o alla scadenza tecnica; la preferenza lingua può durare fino a 12 mesi; gli strumenti di memoria locale e le sottoscrizioni push possono restare salvati nel browser finché l'utente non cancella i dati del sito o disattiva la funzione."
            : "Technical cookies and similar tools used by the site may be session-based or persistent, depending on their purpose. Security tools generally have a short duration; session tools remain active until logout or technical expiry; language preference may last up to 12 months; local storage tools and push subscriptions may remain saved in the browser until the user clears site data or disables the feature."}
        </p>
      </LegalSection>

      <LegalSection title={isIt ? "Come gestire o disattivare i cookie" : "How to Manage or Disable Cookies"}>
        <p>
          {isIt
            ? "L'utente può gestire, limitare o cancellare cookie e altri dati locali direttamente dalle impostazioni del proprio browser. La disattivazione degli strumenti tecnici può però compromettere o impedire il corretto funzionamento del sito, del login, della sessione utente, delle funzioni community, della partecipazione ai viaggi, dei pagamenti del contributo spese e delle notifiche push abilitate."
            : "Users can manage, restrict, or delete cookies and other local data directly through their browser settings. However, disabling technical tools may compromise or prevent the correct functioning of the site, sign-in, user session handling, community features, voyage participation, shared-cost contribution payments, and enabled push notifications."}
        </p>
      </LegalSection>

      <LegalSection title={isIt ? "Aggiornamenti della policy" : "Policy Updates"}>
        <p>
          {isIt
            ? "Questa Cookie Policy può essere aggiornata in caso di modifiche tecniche, normative o funzionali del sito. La versione pubblicata su questa pagina è quella attualmente applicabile."
            : "This Cookie Policy may be updated if the site's technical setup, legal requirements, or features change. The version published on this page is the one currently in force."}
        </p>
      </LegalSection>

      <LegalSection title={isIt ? "Contatti e rinvio alla privacy policy" : "Contacts and Privacy Policy"}>
        <p>
          {isIt ? (
            <>
              Per domande relative a questa policy o al trattamento dei dati personali puoi scrivere a `hello@biteproject.com`. Per maggiori informazioni sul trattamento dei dati personali consulta anche la{" "}
              <Link to="/privacy-policy" className="text-accent hover:text-foreground transition-colors">
                Privacy Policy
              </Link>
              .
            </>
          ) : (
            <>
              For questions about this policy or personal data processing, you can write to `hello@biteproject.com`. For more information about personal data processing, also see the{" "}
              <Link to="/privacy-policy" className="text-accent hover:text-foreground transition-colors">
                Privacy Policy
              </Link>
              .
            </>
          )}
        </p>
      </LegalSection>
    </LegalPageShell>
  );
};

export default CookiePolicy;
