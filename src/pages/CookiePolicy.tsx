import { Link } from "react-router-dom";
import LegalPageShell, { LegalSection } from "@/components/legal/LegalPageShell";
import { useI18n } from "@/lib/i18n";

const CookiePolicy = () => {
  const { lang } = useI18n();
  const isIt = lang === "it";

  const rows = isIt
    ? [
        {
          name: "__cf_bm",
          provider: "Cloudflare",
          type: "Cookie tecnico",
          duration: "circa 30 minuti",
          purpose: "Protegge il sito dal traffico malevolo e aiuta i controlli di sicurezza e anti-bot.",
        },
        {
          name: "bite.visitor-key",
          provider: "BITE",
          type: "Local storage tecnico",
          duration: "persistente, finché non cancelli i dati del sito",
          purpose: "Genera un identificatore locale per contare le letture qualificate degli articoli senza usare analytics pubblicitari.",
        },
        {
          name: "sb-vdflrzcmlipvtardannd-auth-token",
          provider: "Supabase",
          type: "Local storage di sessione",
          duration: "fino al logout o alla scadenza tecnica della sessione",
          purpose: "Mantiene l'accesso dell'utente autenticato all'area community, commenti, like e profilo.",
        },
        {
          name: "bite_ephemeral_session",
          provider: "BITE",
          type: "Local storage tecnico",
          duration: "fino alla chiusura del browser o alla rimozione manuale",
          purpose: "Se scegli di non essere ricordato sul dispositivo, segnala al sito di cancellare la sessione locale alla chiusura.",
        },
      ]
    : [
        {
          name: "__cf_bm",
          provider: "Cloudflare",
          type: "Technical cookie",
          duration: "about 30 minutes",
          purpose: "Protects the site from malicious traffic and supports security and anti-bot checks.",
        },
        {
          name: "bite.visitor-key",
          provider: "BITE",
          type: "Technical local storage",
          duration: "persistent until you clear site data",
          purpose: "Creates a local identifier to count qualified article reads without advertising analytics.",
        },
        {
          name: "sb-vdflrzcmlipvtardannd-auth-token",
          provider: "Supabase",
          type: "Session local storage",
          duration: "until logout or technical session expiry",
          purpose: "Keeps authenticated users signed in for community access, comments, likes, and profile features.",
        },
        {
          name: "bite_ephemeral_session",
          provider: "BITE",
          type: "Technical local storage",
          duration: "until the browser is closed or manually removed",
          purpose: "If you choose not to be remembered on the device, it tells the site to clear the local session on exit.",
        },
      ];

  return (
    <LegalPageShell
      eyebrow={isIt ? "Cookie e Tracciamento" : "Cookies and Tracking"}
      title="Cookie Policy"
      intro={
        isIt
          ? "Questa pagina descrive i cookie e gli strumenti locali effettivamente usati da BITE su biteproject.it alla data del 28 marzo 2026. Il sito non usa cookie pubblicitari né sistemi di profilazione per finalità commerciali."
          : "This page describes the cookies and local technologies actually used by BITE on biteproject.it as verified on March 28, 2026. The site does not use advertising cookies or profiling systems for commercial targeting."
      }
      lastUpdated={isIt ? "Ultimo aggiornamento: 28 marzo 2026" : "Last updated: March 28, 2026"}
    >
      <LegalSection title={isIt ? "Cosa usiamo" : "What We Use"}>
        <p>
          {isIt
            ? "Sulle pagine pubbliche verificate del sito abbiamo rilevato solo strumenti tecnici necessari al funzionamento, alla sicurezza e a una misurazione interna minima delle letture. Non abbiamo rilevato cookie analytics o di marketing caricati automaticamente su home, logbook, login e pagina articolo controllata."
            : "On the public pages we checked, we found only technical tools needed for operation, security, and minimal internal read measurement. We did not detect analytics or marketing cookies loaded automatically on the home page, logbook, login, or the article page we tested."}
        </p>

        <div className="overflow-x-auto rounded-[28px] border border-border bg-background/70">
          <table className="min-w-full text-left">
            <thead className="border-b border-border bg-muted/40">
              <tr>
                <th className="px-4 py-3 text-xs font-sans tracking-[0.18em] uppercase text-muted-foreground">
                  {isIt ? "Nome" : "Name"}
                </th>
                <th className="px-4 py-3 text-xs font-sans tracking-[0.18em] uppercase text-muted-foreground">
                  {isIt ? "Fornitore" : "Provider"}
                </th>
                <th className="px-4 py-3 text-xs font-sans tracking-[0.18em] uppercase text-muted-foreground">
                  {isIt ? "Tipo" : "Type"}
                </th>
                <th className="px-4 py-3 text-xs font-sans tracking-[0.18em] uppercase text-muted-foreground">
                  {isIt ? "Durata" : "Duration"}
                </th>
                <th className="px-4 py-3 text-xs font-sans tracking-[0.18em] uppercase text-muted-foreground">
                  {isIt ? "Finalità" : "Purpose"}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.name} className="border-b border-border last:border-b-0 align-top">
                  <td className="px-4 py-4 text-sm font-mono text-foreground">{row.name}</td>
                  <td className="px-4 py-4 text-sm text-foreground">{row.provider}</td>
                  <td className="px-4 py-4 text-sm text-foreground">{row.type}</td>
                  <td className="px-4 py-4 text-sm text-foreground">{row.duration}</td>
                  <td className="px-4 py-4 text-sm text-muted-foreground">{row.purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-sm">
          {isIt
            ? "Verifica effettuata il 28 marzo 2026 sul dominio pubblico biteproject.it. Il cookie Cloudflare osservato è stato ricevuto dal server; il local storage bite.visitor-key è stato creato dopo una lettura qualificata di circa 30 secondi su un articolo."
            : "Verification was performed on March 28, 2026 on the public domain biteproject.it. The observed Cloudflare cookie was set by the server; the bite.visitor-key local storage entry was created after an article had been read for about 30 seconds."}
        </p>
      </LegalSection>

      <LegalSection title={isIt ? "Servizi caricati solo su richiesta o in pagine specifiche" : "Services Loaded Only on Request or on Specific Pages"}>
        <p>
          {isIt
            ? "Alcune funzioni possono coinvolgere servizi terzi solo quando l'utente le richiede o visita sezioni specifiche:"
            : "Some features may involve third-party services only when the user requests them or visits specific sections:"}
        </p>
        <ul className="space-y-3 list-disc pl-5">
          <li>
            {isIt
              ? "Login con Google: viene avviato solo se clicchi il relativo pulsante. Eventuali cookie o altri identificatori di Google sono gestiti sui domini Google secondo la loro informativa."
              : "Google login: this starts only if you click the relevant button. Any Google cookies or similar identifiers are managed on Google domains under Google's own policy."}
          </li>
          <li>
            {isIt
              ? "Video YouTube negli articoli: gli embed sono configurati in modalità youtube-nocookie.com per ridurre il tracciamento preventivo. Se interagisci con il player, YouTube/Google può comunque trattare dati tecnici secondo la propria policy."
              : "YouTube videos inside articles: embeds are configured through youtube-nocookie.com to reduce pre-emptive tracking. If you interact with the player, YouTube/Google may still process technical data under its own policy."}
          </li>
          <li>
            {isIt
              ? "Mappe: alcune pagine caricano tiles e servizi cartografici di CARTO/OpenStreetMap e contenuti media da Supabase. Nelle verifiche svolte non abbiamo rilevato cookie aggiuntivi automatici su queste risorse, ma vengono effettuate richieste tecniche ai rispettivi provider."
              : "Maps: some pages load map tiles and mapping services from CARTO/OpenStreetMap and media content from Supabase. During our checks we did not detect additional automatic cookies on these resources, but technical requests are sent to those providers."}
          </li>
        </ul>
      </LegalSection>

      <LegalSection title={isIt ? "Base giuridica e consenso" : "Legal Basis and Consent"}>
        <p>
          {isIt
            ? "I cookie e gli strumenti sopra elencati sono usati per erogare il sito, mantenerlo sicuro, ricordare la sessione di accesso e contare in modo minimale le letture effettive degli articoli. Per queste finalità non è richiesto un consenso preventivo separato perché si tratta di strumenti tecnici o strettamente connessi a un servizio richiesto dall'utente."
            : "The cookies and local technologies listed above are used to deliver the site, keep it secure, remember sign-in state, and count actual article reads in a minimal way. No separate prior consent is required for these purposes because they are technical tools or are strictly connected to a service requested by the user."}
        </p>
        <p>
          {isIt
            ? "Se in futuro verranno introdotti cookie analytics non anonimizzati, cookie di profilazione o altri strumenti non tecnici, questa policy e il relativo meccanismo di raccolta del consenso dovranno essere aggiornati prima dell'attivazione."
            : "If non-anonymized analytics cookies, profiling cookies, or other non-technical trackers are introduced in the future, this policy and the consent collection mechanism will need to be updated before they are activated."}
        </p>
      </LegalSection>

      <LegalSection title={isIt ? "Come gestirli" : "How to Manage Them"}>
        <p>
          {isIt
            ? "Puoi cancellare o bloccare cookie e local storage dal browser. La disattivazione dei cookie tecnici o della memoria locale del sito può però compromettere accesso, commenti, like, conteggio letture e altre funzioni della community."
            : "You can delete or block cookies and local storage through your browser settings. However, disabling technical cookies or local storage may affect sign-in, comments, likes, read counting, and other community features."}
        </p>
        <p>
          {isIt ? (
            <>
              Per le informazioni sul trattamento dei dati personali collegato all'uso del sito, consulta anche la{" "}
              <Link to="/privacy-policy" className="text-accent hover:text-foreground transition-colors">
                Privacy Policy
              </Link>
              .
            </>
          ) : (
            <>
              For information about personal data processing linked to the use of the site, also see the{" "}
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
