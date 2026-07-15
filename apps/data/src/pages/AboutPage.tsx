import { ExternalLink } from "lucide-react";

const AboutPage = () => (
  <div>
    <section className="page-section page-section-narrow">
      <div className="glass-chip inline-flex items-center gap-2 px-4 py-2 text-[11px] font-sans uppercase tracking-[0.25em] text-muted-foreground mb-8">
        About the Project
      </div>
      <h1 className="editorial-heading text-4xl md:text-5xl text-foreground mb-8">
        A sailing vessel as a mobile observation platform
      </h1>
      <div className="space-y-6 font-sans text-muted-foreground leading-relaxed">
        <p>
          <strong className="text-foreground">data.biteproject.it</strong> is the scientific data branch of the{" "}
          <a href="https://biteproject.it" target="_blank" rel="noopener noreferrer" className="text-teal hover:text-teal-muted transition-colors inline-flex items-center gap-1">
            BITE Project <ExternalLink size={12} />
          </a>
          , which documents life, travel, and long-range sailing aboard the vessel Spritz. While the main project tells the human story, this portal focuses on what the sea itself has to say — through data.
        </p>
        <p>
          The idea is straightforward: a sailing boat crosses real stretches of open water, often far from coastal monitoring stations. Equipped with basic environmental sensors, it can collect measurements — sea surface temperature, air temperature, humidity, barometric pressure, wind conditions — along routes that commercial shipping and research vessels rarely cover at this scale or frequency.
        </p>

        <h2 className="editorial-heading text-2xl text-foreground pt-6">Why a sailing vessel?</h2>
        <p>
          Institutional ocean monitoring relies heavily on fixed stations, satellite remote sensing, and dedicated research cruises. These methods are essential, but they have gaps. Coastal stations don't reach the open sea. Satellites measure surface conditions indirectly. Research cruises are expensive and infrequent. A sailing vessel — slow, low-energy, already crossing these waters — can fill some of those gaps with modest but continuous field measurements.
        </p>
        <p>
          Spritz is not a laboratory ship. The instruments are field-grade, the conditions are real, and the data reflects the practical limits of collection underway. But that is also the point: this data is genuine, situated, and taken in conditions that matter.
        </p>

        <h2 className="editorial-heading text-2xl text-foreground pt-6">Why publish freely?</h2>
        <p>
          Environmental data collected in the field — especially in under-monitored areas — has value beyond any single project. By releasing datasets under open-access terms, we allow researchers, institutions, educators, and curious minds to use this material for their own purposes. There is no paywall, no registration requirement, and no commercial intent. If the data is useful, it should be available.
        </p>

        <h2 className="editorial-heading text-2xl text-foreground pt-6">Citizen science, without the hype</h2>
        <p>
          This project does not claim to replace institutional monitoring or produce research-grade datasets on its own. It is a citizen science initiative in the original sense: individuals contributing field observations to a shared pool of knowledge, transparently and without pretension. The data is what it is — field-collected, documented, limited, and real.
        </p>

        <h2 className="editorial-heading text-2xl text-foreground pt-6">Who benefits?</h2>
        <ul className="list-disc list-inside space-y-2">
          <li>Marine researchers seeking supplementary field data from under-monitored routes</li>
          <li>Universities incorporating real-world datasets into teaching or student projects</li>
          <li>Environmental organizations tracking long-term conditions in specific basins</li>
          <li>Data analysts exploring open environmental datasets</li>
          <li>Anyone interested in the physical conditions of the seas Spritz crosses</li>
        </ul>
      </div>
    </section>
  </div>
);

export default AboutPage;
