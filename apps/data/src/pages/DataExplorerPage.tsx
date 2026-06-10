import { useState } from "react";
import FilterBar from "@/components/data/FilterBar";
import DatasetCard from "@/components/data/DatasetCard";

const filters = [
  { label: "All", active: true },
  { label: "SST" },
  { label: "Air Temp" },
  { label: "Wind" },
  { label: "Pressure" },
  { label: "Humidity" },
];

const datasets = [
  {
    title: "Western Mediterranean SST — Autumn 2025",
    date: "Sep–Oct 2025",
    location: "Sardinia → Balearics",
    variables: ["SST", "GPS", "Timestamp"],
    observations: 3420,
    status: "available" as const,
  },
  {
    title: "Tyrrhenian Coastal Atmospheric Survey",
    date: "Jun–Aug 2025",
    location: "Tyrrhenian Sea",
    variables: ["Air Temp", "Humidity", "Pressure"],
    observations: 2860,
    status: "available" as const,
  },
  {
    title: "Bonifacio Strait Wind Profile",
    date: "Nov 2025",
    location: "Corsica–Sardinia",
    variables: ["Wind Speed", "Wind Dir.", "Pressure"],
    observations: 890,
    status: "processing" as const,
  },
  {
    title: "Balearic Sea Multi-Parameter Dataset",
    date: "Oct 2025",
    location: "Balearic Sea",
    variables: ["SST", "Air Temp", "Wind", "Humidity"],
    observations: 1540,
    status: "available" as const,
  },
  {
    title: "Central Mediterranean Spring Survey",
    date: "Apr–May 2025",
    location: "Sicily Channel",
    variables: ["SST", "Pressure", "GPS"],
    observations: 2100,
    status: "available" as const,
  },
  {
    title: "Adriatic North Winter Baseline",
    date: "Jan–Feb 2026",
    location: "Northern Adriatic",
    variables: ["SST", "Air Temp", "Humidity", "Pressure"],
    observations: 0,
    status: "planned" as const,
  },
];

const DataExplorerPage = () => {
  const [activeFilters, setActiveFilters] = useState(filters);

  const handleFilterClick = (label: string) => {
    setActiveFilters((prev) =>
      prev.map((f) => ({
        ...f,
        active: f.label === label,
      }))
    );
  };

  return (
    <div>
      <section className="page-section page-section-wide">
        <div className="mb-8">
          <h1 className="editorial-heading text-4xl text-foreground mb-3">Data Explorer</h1>
          <p className="font-sans text-muted-foreground max-w-2xl">
            Browse environmental datasets collected during BITE voyages. Filter by sensor type, date, or geographic area. All available datasets can be downloaded in CSV or JSON format.
          </p>
        </div>

        <div className="mb-6">
          <FilterBar
            filters={activeFilters}
            onFilterClick={handleFilterClick}
            placeholder="Search by mission, variable, or region..."
          />
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {datasets.map((ds) => (
            <DatasetCard key={ds.title} {...ds} />
          ))}
        </div>

        <div className="mt-8 text-center">
          <p className="text-sm font-sans text-muted-foreground">
            Showing {datasets.length} datasets · Data is updated after each mission
          </p>
        </div>
      </section>
    </div>
  );
};

export default DataExplorerPage;
