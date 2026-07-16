import { ExternalLink } from "lucide-react";

const MethodologyPage = () => (
  <div>
    <section className="page-section page-section-narrow">
      <div className="glass-chip inline-flex items-center gap-2 px-4 py-2 text-[11px] font-sans uppercase tracking-[0.25em] text-muted-foreground mb-8">
        Methodology & Limitations
      </div>
      <h1 className="editorial-heading text-4xl md:text-5xl text-foreground mb-6">
        A sailing vessel as a mobile observation platform
      </h1>
      <p className="font-sans text-muted-foreground leading-relaxed mb-12 max-w-2xl">
        Transparency about methods, instruments, and limitations is fundamental to this project. This page documents what this platform is, how data is gathered, what can go wrong, and how to interpret what we publish.
      </p>

      <div className="space-y-12">
        {/* The platform */}
        <div className="glass-panel rounded-2xl p-6 md:p-8">
          <h2 className="editorial-heading text-2xl text-foreground mb-4">The platform</h2>
          <div className="space-y-4 font-sans text-muted-foreground leading-relaxed text-sm">
            <p>
              <strong className="text-foreground">data.biteproject.it</strong> is the scientific data branch of the{" "}
              <a
                href="https://biteproject.it"
                target="_blank"
                rel="noopener noreferrer"
                className="text-teal hover:text-teal-muted transition-colors inline-flex items-center gap-1"
              >
                BITE Project <ExternalLink size={12} />
              </a>
              , which documents life, travel, and long-range sailing aboard the vessel Spritz. While the main project tells the human story, this portal focuses on what the sea itself has to say — through data.
            </p>
            <p>
              The idea is straightforward: a sailing boat crosses real stretches of open water, often far from coastal monitoring stations. Equipped with basic environmental sensors, it can collect measurements along routes that commercial shipping and research vessels rarely cover at this scale or frequency.
            </p>
            <p>
              Institutional ocean monitoring relies heavily on fixed stations, satellite remote sensing, and dedicated research cruises. These methods are essential, but they have gaps. Coastal stations don't reach the open sea. Satellites measure surface conditions indirectly. Research cruises are expensive and infrequent. A sailing vessel — slow, low-energy, already crossing these waters — can fill some of those gaps with modest but continuous field measurements.
            </p>
            <p>
              Spritz is not a laboratory ship. The instruments are field-grade, the conditions are real, and the data reflects the practical limits of collection underway. But that is also the point: this data is genuine, situated, and taken in conditions that matter.
            </p>
            <p>
              This project does not claim to replace institutional monitoring or produce research-grade datasets on its own. It is a citizen science initiative in the original sense: individuals contributing field observations to a shared pool of knowledge, transparently and without pretension. The data is what it is — field-collected, documented, limited, and real.
            </p>
          </div>
        </div>

        {/* Collection */}
        <div className="glass-panel rounded-2xl p-6 md:p-8">
          <h2 className="editorial-heading text-2xl text-foreground mb-4">Data Collection</h2>
          <div className="space-y-4 font-sans text-muted-foreground leading-relaxed text-sm">
            <p>
              Environmental measurements are collected continuously during active navigation. Sensors sample at regular intervals — typically every 30 seconds to 5 minutes depending on the parameter — and each reading is automatically timestamped (UTC) and geolocated via onboard GPS.
            </p>
            <p>
              Data logging begins when the vessel departs and stops when it arrives. During extended passages, the system runs autonomously. During port stops, only atmospheric sensors continue sampling when the system is powered.
            </p>
            <p>
              The vessel follows its planned route; it does not deviate for sampling purposes. This means data coverage follows actual navigation tracks, not a predetermined scientific survey grid.
            </p>
          </div>
        </div>

        {/* Timestamping */}
        <div className="glass-panel rounded-2xl p-6 md:p-8">
          <h2 className="editorial-heading text-2xl text-foreground mb-4">Timestamping & Geolocation</h2>
          <div className="space-y-4 font-sans text-muted-foreground leading-relaxed text-sm">
            <p>
              All timestamps are recorded in UTC to avoid timezone ambiguity. GPS coordinates are logged alongside each measurement, allowing geographic reconstruction of the data path. Position accuracy is standard civilian GPS (~3–5 meters).
            </p>
            <p>
              In cases where GPS signal is temporarily lost (heavy weather, proximity to cliffs), interpolation between the last and next valid positions is used to estimate location. These cases are flagged in the dataset metadata.
            </p>
          </div>
        </div>

        {/* Limitations */}
        <div className="glass-panel rounded-2xl p-6 md:p-8">
          <h2 className="editorial-heading text-2xl text-foreground mb-4">Known Limitations</h2>
          <div className="space-y-4 font-sans text-muted-foreground leading-relaxed text-sm">
            <p>
              This is field-collected data from a moving sailing vessel, not from a controlled laboratory or a dedicated research platform. Several factors affect data quality:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-2">
              <li><strong className="text-foreground">Vessel motion</strong> — Pitch, roll, and heeling can influence sensor readings, particularly wind measurements and temperature sensors exposed to spray.</li>
              <li><strong className="text-foreground">Sensor grade</strong> — Instruments are marine-grade consumer or semi-professional sensors, not laboratory-calibrated research instruments.</li>
              <li><strong className="text-foreground">Environmental interference</strong> — Salt spray, engine heat, solar radiation on deck, and wave splash can temporarily affect measurements.</li>
              <li><strong className="text-foreground">Irregular intervals</strong> — While sampling is designed to be regular, power interruptions, system reboots, or manual overrides may create gaps.</li>
              <li><strong className="text-foreground">Coverage bias</strong> — Data is collected only along sailing routes, not across a uniform geographic grid. Certain areas may be over- or under-represented.</li>
              <li><strong className="text-foreground">Seasonal gaps</strong> — The vessel does not sail year-round in all areas, creating seasonal bias in multi-year datasets.</li>
            </ul>
          </div>
        </div>

        {/* Processing */}
        <div className="glass-panel rounded-2xl p-6 md:p-8">
          <h2 className="editorial-heading text-2xl text-foreground mb-4">Processing & Quality Control</h2>
          <div className="space-y-4 font-sans text-muted-foreground leading-relaxed text-sm">
            <p>
              Raw sensor data undergoes basic automated quality checks before publication:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-2">
              <li>Range validation — readings outside physically plausible bounds are flagged</li>
              <li>Spike detection — sudden jumps inconsistent with surrounding data are marked</li>
              <li>Timestamp continuity — gaps and irregularities in logging intervals are noted</li>
              <li>GPS validation — stationary readings during movement or vice versa are flagged</li>
            </ul>
            <p>
              Flagged data is not removed but is annotated in the dataset. Users can decide how to handle these cases in their own analysis.
            </p>
          </div>
        </div>

        {/* Interpretation */}
        <div className="glass-panel rounded-2xl p-6 md:p-8">
          <h2 className="editorial-heading text-2xl text-foreground mb-4">Interpretation Guidance</h2>
          <div className="space-y-4 font-sans text-muted-foreground leading-relaxed text-sm">
            <p>
              Users should treat this data as supplementary field observations, not as reference-grade measurements. It is suitable for:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-2">
              <li>Exploratory analysis and trend identification</li>
              <li>Cross-referencing with satellite or institutional datasets</li>
              <li>Educational purposes and student projects</li>
              <li>Route-specific environmental profiling</li>
              <li>Citizen science aggregation alongside other sources</li>
            </ul>
            <p>
              It is not suitable for precision climate modeling, regulatory compliance reporting, or safety-critical marine operations without independent verification.
            </p>
          </div>
        </div>
      </div>
    </section>
  </div>
);

export default MethodologyPage;
