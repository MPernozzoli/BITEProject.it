import { ReactNode } from "react";
import {
  Thermometer,
  Wind,
  Droplets,
  Gauge,
  Navigation,
  BookOpen,
  Waves,
  FlaskConical,
  Bug,
  Compass,
} from "lucide-react";
import SensorCard from "@/components/data/SensorCard";
import { useObservationParameters } from "@/hooks/use-observations";

/**
 * The page renders whatever is published in `observation_parameters`, so adding a sensor is
 * a row in the catalog and never an edit here — the old hard-coded list had already fallen
 * out of step with the data. Only the icon is presentation and stays in the frontend; an
 * unmapped code falls back to the generic one.
 */
const ICONS: Record<string, ReactNode> = {
  sst: <Thermometer size={22} />,
  air_temp: <Thermometer size={22} />,
  humidity: <Droplets size={22} />,
  pressure: <Gauge size={22} />,
  wind_speed: <Wind size={22} />,
  wind_direction: <Compass size={22} />,
  dissolved_oxygen: <FlaskConical size={22} />,
  salinity: <Waves size={22} />,
  plankton_density: <Bug size={22} />,
  sea_state: <BookOpen size={22} />,
};

const SensorsPage = () => {
  const { data: parameters = [], isLoading } = useObservationParameters();

  return (
    <div>
      <section className="page-section page-section-wide">
        <div className="mb-10 max-w-2xl">
          <div className="glass-chip inline-flex items-center gap-2 px-4 py-2 text-[11px] font-sans uppercase tracking-[0.25em] text-muted-foreground mb-8">
            Sensors & Data Types
          </div>
          <h1 className="editorial-heading text-4xl md:text-5xl text-foreground mb-4">
            What we measure
          </h1>
          <p className="font-sans text-muted-foreground leading-relaxed">
            Every variable published by this portal, with its unit, its declared instrument accuracy,
            and what to distrust about it. This list is generated from the same catalog the map and the
            downloads read, so it cannot fall out of step with the data.
          </p>
        </div>

        {isLoading ? (
          <p className="text-sm font-sans text-muted-foreground animate-pulse">Loading catalog…</p>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {parameters.map((p) => (
              <SensorCard
                key={p.code}
                name={p.label_en}
                unit={p.unit}
                icon={ICONS[p.code] ?? <Navigation size={22} />}
                description={p.description_en ?? ""}
                accuracy={p.accuracy}
                limitations={p.limitations_en}
              />
            ))}
          </div>
        )}

        <div className="glass-panel rounded-2xl p-6 mt-10">
          <h2 className="editorial-heading text-lg text-foreground mb-2">Position and time</h2>
          <p className="text-sm font-sans text-muted-foreground leading-relaxed">
            Every reading above hangs off a sampling point: a position from the onboard GPS (standard
            civilian accuracy, roughly 3–5 m) and an instant recorded in UTC. Those two fields are the
            geographic and temporal backbone of the dataset — the timestamp is also what attributes a
            point to a voyage. Each reading carries its own quality flag on the{" "}
            <span className="text-foreground">IODE scale</span> (0 no QC performed, 1 good, 2 probably
            good, 3 probably bad, 4 bad, 9 missing); flagged data is annotated, never silently dropped.
          </p>
        </div>
      </section>
    </div>
  );
};

export default SensorsPage;
