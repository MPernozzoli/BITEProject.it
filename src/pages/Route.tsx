import { useI18n } from "@/lib/i18n";
import { Anchor, MapPin, Navigation, Clock } from "lucide-react";

const pastStops = [
  { name: "Gdańsk, Poland", note: "Where it all started. Purchase and initial refit." },
  { name: "Hel Peninsula", note: "First real sail. Engine issues. Lessons learned fast." },
  { name: "Bornholm, Denmark", note: "A Baltic detour. Quiet harbors and cold water." },
  { name: "Kiel Canal, Germany", note: "Transiting into the North Sea." },
  { name: "Biscay Crossing", note: "48 hours of open ocean. No sleep. Maximum respect." },
  { name: "Galicia, Spain", note: "Rain, rias, and the best pulpo of our lives." },
  { name: "Gibraltar Strait", note: "Currents, shipping lanes, and a very long night." },
  { name: "Sardinia, Italy", note: "Anchorages so clear you could read the anchor chain." },
  { name: "Greece, Ionian", note: "Island-hopping, refit stops, and the dogs' favorite beaches." },
];

const futureStops = [
  { name: "Peloponnese & Aegean", note: "Heading east through the Greek islands." },
  { name: "Turkey", note: "Exploring the Turkish coast. Affordable refit options." },
  { name: "Back to Italy", note: "Returning for winter work and planning." },
];

const Route = () => {
  const { t } = useI18n();

  return (
    <div>
      <section className="pt-32 pb-20 md:pt-40 md:pb-32 px-6 md:px-12">
        <div className="page-section-narrow">
          <h1 className="editorial-heading text-4xl md:text-6xl lg:text-7xl mb-4">
            {t("route.page.title")}
          </h1>
          <p className="editorial-body text-lg text-muted-foreground">
            {t("route.page.subtitle")}
          </p>
        </div>
      </section>

      {/* Status Dashboard */}
      <section className="px-6 md:px-12 pb-20 md:pb-32">
        <div className="page-section-wide">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="border border-border p-8">
              <MapPin size={20} className="text-accent mb-4" />
              <p className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-2">
                {t("route.status.location")}
              </p>
              <p className="editorial-heading text-xl">Ionian Sea, Greece</p>
            </div>
            <div className="border border-border p-8">
              <Clock size={20} className="text-accent mb-4" />
              <p className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-2">
                {t("route.status.phase")}
              </p>
              <p className="editorial-heading text-xl">Summer sailing season</p>
            </div>
            <div className="border border-border p-8">
              <Navigation size={20} className="text-accent mb-4" />
              <p className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-2">
                {t("route.status.next")}
              </p>
              <p className="editorial-heading text-xl">Peloponnese</p>
            </div>
          </div>
        </div>
      </section>

      {/* Map Placeholder */}
      <section className="px-6 md:px-12 pb-20 md:pb-32">
        <div className="page-section-wide">
          <div className="aspect-[21/9] bg-muted flex items-center justify-center border border-border">
            <div className="text-center">
              <Anchor size={48} className="text-muted-foreground/30 mx-auto mb-4" />
              <p className="text-muted-foreground font-sans">Interactive route map</p>
              <p className="text-xs text-muted-foreground/50 mt-1">Will be integrated here</p>
            </div>
          </div>
        </div>
      </section>

      {/* Past Stops */}
      <section className="page-section bg-salt-warm">
        <div className="page-section-narrow">
          <h2 className="editorial-heading text-3xl md:text-4xl mb-12">{t("route.past.title")}</h2>
          <div className="space-y-0">
            {pastStops.map((stop, i) => (
              <div key={i} className="flex gap-6 py-6 border-b border-border last:border-0">
                <span className="text-xs font-sans text-muted-foreground/40 pt-1 w-8 shrink-0">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <h3 className="editorial-heading text-lg mb-1">{stop.name}</h3>
                  <p className="text-sm text-muted-foreground">{stop.note}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Future */}
      <section className="page-section">
        <div className="page-section-narrow">
          <h2 className="editorial-heading text-3xl md:text-4xl mb-12">{t("route.future.title")}</h2>
          <div className="space-y-0">
            {futureStops.map((stop, i) => (
              <div key={i} className="flex gap-6 py-6 border-b border-border/50 last:border-0">
                <span className="text-xs font-sans text-accent pt-1 w-8 shrink-0">→</span>
                <div>
                  <h3 className="editorial-heading text-lg mb-1">{stop.name}</h3>
                  <p className="text-sm text-muted-foreground">{stop.note}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
};

export default Route;
