import SensorCard from "@/components/data/SensorCard";
import { Thermometer, Wind, Droplets, Gauge, Navigation, BookOpen } from "lucide-react";

const sensors = [
  {
    name: "Sea Surface Temperature",
    description: "Water temperature measured at hull depth, typically 0.3–0.5 meters below the waterline. Provides a localized reading of surface conditions along the route, useful for tracking thermal gradients and seasonal changes.",
    unit: "°C",
    icon: <Thermometer size={22} />,
    limitations: "Readings reflect hull-depth temperature, not true skin SST. Accuracy affected by boat speed and solar heating of the hull.",
  },
  {
    name: "Air Temperature",
    description: "Ambient air temperature measured from a shielded sensor on deck. Captures atmospheric conditions at sea level during navigation, complementing sea surface data for air-sea interaction studies.",
    unit: "°C",
    icon: <Thermometer size={22} />,
    limitations: "Sensor may be influenced by engine heat or solar radiation on deck in calm conditions.",
  },
  {
    name: "Relative Humidity",
    description: "Percentage of moisture in the air at the measurement location. Relevant for understanding evaporation rates, fog formation potential, and maritime atmospheric conditions.",
    unit: "% RH",
    icon: <Droplets size={22} />,
    limitations: "Salt spray can temporarily affect readings. Sensor requires periodic calibration in marine environments.",
  },
  {
    name: "Barometric Pressure",
    description: "Atmospheric pressure at sea level. Essential for weather pattern tracking, storm detection, and understanding pressure gradients across navigation routes.",
    unit: "hPa",
    icon: <Gauge size={22} />,
    limitations: "Minor variations possible due to vessel movement. Altitude correction not required at sea level.",
  },
  {
    name: "Wind Speed & Direction",
    description: "Apparent wind measurements taken from a masthead anemometer. Converted to true wind using GPS speed and course over ground. Provides continuous wind profiles along the route.",
    unit: "kt / degrees",
    icon: <Wind size={22} />,
    limitations: "Apparent-to-true wind conversion introduces small errors. Masthead turbulence from sails may affect readings.",
  },
  {
    name: "GPS Position & Route",
    description: "Continuous position logging at regular intervals using onboard GPS. Provides the geographic backbone for all other measurements — every data point is geolocated and timestamped.",
    unit: "Lat/Lng, UTC",
    icon: <Navigation size={22} />,
    limitations: "Standard civilian GPS accuracy (3–5 m). Brief signal loss possible in heavy weather or near cliffs.",
  },
  {
    name: "Field Notes & Observations",
    description: "Manual observations recorded by crew during navigation: sea state, cloud cover, wildlife sightings, unusual conditions. Provides qualitative context for quantitative measurements.",
    unit: "Text / Categorical",
    icon: <BookOpen size={22} />,
    limitations: "Subjective, irregular intervals, dependent on crew attention and conditions.",
  },
];

const SensorsPage = () => (
  <div>
    <section className="page-section page-section-wide">
      <div className="mb-10">
        <h1 className="editorial-heading text-4xl text-foreground mb-3">Sensors & Data Types</h1>
        <p className="font-sans text-muted-foreground max-w-2xl">
          An overview of the environmental parameters collected aboard Spritz, how they are measured, and their practical limitations. All instruments are field-grade and selected for reliability in marine conditions.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {sensors.map((s) => (
          <SensorCard key={s.name} {...s} />
        ))}
      </div>
    </section>
  </div>
);

export default SensorsPage;
