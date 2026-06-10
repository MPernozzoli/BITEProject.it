import { Link } from "react-router-dom";
import { ArrowRight, Database, Map, Compass, Waves, Wind, Thermometer, BarChart3, Globe, Users, BookOpen } from "lucide-react";
import MetricCard from "@/components/data/MetricCard";
import MissionCard from "@/components/data/MissionCard";
import { useVoyages, useAllWaypoints, formatDateRange } from "@/hooks/use-voyages";

const HomePage = () => {
  const { data: voyages = [] } = useVoyages();
  const { data: waypoints = [] } = useAllWaypoints();

  const waterVoyages = voyages.filter(v => v.type === "water");
  const totalWaypoints = waypoints.length;
  const completedCount = waterVoyages.filter(v => v.status === "completed").length;

  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-navy via-navy-light to-transparent" />
        <div className="absolute inset-0 opacity-20">
          <div className="absolute top-20 left-10 w-96 h-96 rounded-full bg-teal/20 blur-[100px]" />
          <div className="absolute bottom-10 right-20 w-80 h-80 rounded-full bg-data-blue/15 blur-[80px]" />
        </div>
        <div className="relative page-section page-section-wide pt-20 md:pt-32 pb-24 md:pb-36">
          <div className="max-w-3xl">
            <div className="glass-chip-dark inline-flex items-center gap-2 px-4 py-2 text-[11px] font-sans uppercase tracking-[0.25em] text-primary-foreground/70 mb-8">
              <span className="h-2 w-2 rounded-full bg-data-green animate-pulse" />
              Citizen Science · Open Data
            </div>
            <h1 className="editorial-heading text-4xl md:text-5xl lg:text-6xl text-primary-foreground mb-6">
              Field observations from the open sea
            </h1>
            <p className="text-lg md:text-xl font-sans text-primary-foreground/70 leading-relaxed max-w-2xl mb-10">
              A public citizen science data portal built from environmental and navigation measurements collected aboard <em className="text-primary-foreground/90 not-italic font-medium">Spritz</em> during real sailing routes across the Mediterranean and beyond.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link to="/data" className="glass-chip-dark inline-flex items-center gap-2 px-6 py-3 text-sm font-sans font-medium text-primary-foreground hover:translate-y-[-1px] transition-all">
                Explore the data <ArrowRight size={16} />
              </Link>
              <Link to="/map" className="glass-chip-dark inline-flex items-center gap-2 px-6 py-3 text-sm font-sans text-primary-foreground/70 hover:text-primary-foreground hover:translate-y-[-1px] transition-all">
                <Map size={16} /> View the map
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Data snapshot */}
      <section className="page-section page-section-wide -mt-12 relative z-10">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard value={totalWaypoints.toLocaleString()} label="Waypoints" icon={<Database size={20} />} />
          <MetricCard value={`${waterVoyages.length}`} label="Voyages" icon={<Compass size={20} />} />
          <MetricCard value={`${completedCount}`} label="Completed" icon={<BarChart3 size={20} />} />
          <MetricCard value="6" label="Active Sensors" icon={<Thermometer size={20} />} />
        </div>
      </section>

      {/* What we collect */}
      <section className="page-section page-section-wide">
        <div className="text-center mb-12">
          <h2 className="editorial-heading text-3xl md:text-4xl text-foreground mb-4">What we measure</h2>
          <p className="text-muted-foreground font-sans max-w-xl mx-auto">
            Environmental and navigation parameters collected in the field during actual voyages, using onboard sensor systems.
          </p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {[
            { icon: <Thermometer size={20} />, label: "Sea Surface Temp", desc: "Water temperature at hull depth" },
            { icon: <Thermometer size={20} />, label: "Air Temperature", desc: "Ambient air readings" },
            { icon: <Waves size={20} />, label: "Humidity", desc: "Relative humidity percentage" },
            { icon: <BarChart3 size={20} />, label: "Barometric Pressure", desc: "Atmospheric pressure in hPa" },
            { icon: <Wind size={20} />, label: "Wind Speed & Dir.", desc: "Apparent wind at masthead" },
            { icon: <Globe size={20} />, label: "GPS Position", desc: "Timestamped coordinates" },
            { icon: <Compass size={20} />, label: "Route Track", desc: "Continuous navigation path" },
            { icon: <BookOpen size={20} />, label: "Field Notes", desc: "Environmental observations" },
          ].map((item) => (
            <div key={item.label} className="glass-panel rounded-2xl p-5 flex flex-col gap-3">
              <div className="text-teal">{item.icon}</div>
              <h3 className="font-sans text-sm font-semibold text-foreground">{item.label}</h3>
              <p className="text-xs font-sans text-muted-foreground">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Latest Missions — from real data */}
      <section className="page-section page-section-wide">
        <div className="flex items-end justify-between mb-8">
          <div>
            <h2 className="editorial-heading text-3xl text-foreground mb-2">Latest missions</h2>
            <p className="text-muted-foreground font-sans text-sm">Recent voyages with active data collection</p>
          </div>
          <Link to="/missions" className="text-sm font-sans font-medium text-teal hover:text-teal-light transition-colors inline-flex items-center gap-1">
            All missions <ArrowRight size={14} />
          </Link>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {waterVoyages.slice(0, 3).map((v) => (
            <MissionCard
              key={v.id}
              title={v.name_en || v.name}
              dateRange={formatDateRange(v.start_date, v.end_date)}
              area={v.description_en || v.description || "Mediterranean"}
              sensors={["SST", "Wind", "GPS"]}
              observations={waypoints.filter(w => w.voyage_id === v.id).length}
              status={v.status}
            />
          ))}
        </div>
      </section>

      {/* Open Access */}
      <section className="page-section">
        <div className="page-section-wide">
          <div className="glass-panel-dark rounded-3xl p-8 md:p-12 flex flex-col md:flex-row gap-8 md:gap-16 items-start">
            <div className="flex-1">
              <h2 className="editorial-heading text-3xl text-primary-foreground mb-4">Open access, by design</h2>
              <p className="font-sans text-primary-foreground/70 leading-relaxed mb-6">
                All data collected during BITE voyages is published freely under open-access terms. Researchers, students, institutions, and the public may download, explore, and cite datasets without restriction. We believe field-collected environmental data should serve science, not sit in private storage.
              </p>
              <div className="flex flex-wrap gap-3">
                <Link to="/downloads" className="glass-chip-dark inline-flex items-center gap-2 px-5 py-2.5 text-sm font-sans font-medium text-primary-foreground hover:translate-y-[-1px] transition-all">
                  Access datasets <ArrowRight size={14} />
                </Link>
                <Link to="/methodology" className="glass-chip-dark inline-flex items-center gap-2 px-5 py-2.5 text-sm font-sans text-primary-foreground/60 hover:text-primary-foreground transition-all">
                  Read methodology
                </Link>
              </div>
            </div>
            <div className="flex flex-col gap-4 shrink-0">
              {[
                { icon: <Users size={18} />, label: "Universities & researchers" },
                { icon: <Globe size={18} />, label: "Environmental institutes" },
                { icon: <BarChart3 size={18} />, label: "Data analysts" },
                { icon: <BookOpen size={18} />, label: "Students & educators" },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-3 text-primary-foreground/60 text-sm font-sans">
                  <span className="text-teal-light">{item.icon}</span>
                  {item.label}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Methodology preview */}
      <section className="page-section page-section-wide">
        <div className="grid md:grid-cols-2 gap-8 items-center">
          <div>
            <h2 className="editorial-heading text-3xl text-foreground mb-4">Transparent methodology</h2>
            <p className="font-sans text-muted-foreground leading-relaxed mb-4">
              Data is collected underway during normal sailing operations. We document sensor placement, sampling intervals, known limitations, and processing steps. We do not overclaim precision — every dataset includes metadata about conditions, coverage gaps, and measurement context.
            </p>
            <Link to="/methodology" className="text-sm font-sans font-medium text-teal hover:text-teal-light transition-colors inline-flex items-center gap-1">
              Full methodology <ArrowRight size={14} />
            </Link>
          </div>
          <div className="glass-panel rounded-2xl p-6">
            <div className="space-y-4">
              {[
                { label: "Collection", desc: "Continuous sampling during navigation, timestamped and geolocated" },
                { label: "Processing", desc: "Automated quality checks, outlier flagging, format standardization" },
                { label: "Publication", desc: "Open-access release with metadata, versioning, and citation guidance" },
              ].map((step, i) => (
                <div key={step.label} className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <span className="h-7 w-7 rounded-full bg-teal/10 text-teal flex items-center justify-center text-xs font-sans font-bold">{i + 1}</span>
                    {i < 2 && <div className="w-px h-full bg-border mt-1" />}
                  </div>
                  <div className="pb-4">
                    <h4 className="font-sans text-sm font-semibold text-foreground">{step.label}</h4>
                    <p className="text-xs font-sans text-muted-foreground mt-1">{step.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="page-section page-section-narrow text-center">
        <h2 className="editorial-heading text-3xl text-foreground mb-4">Contribute to open marine science</h2>
        <p className="font-sans text-muted-foreground max-w-lg mx-auto mb-8">
          Whether you're a researcher seeking field data, a university exploring citizen science partnerships, or simply curious about the sea — the data is here.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link to="/data" className="glass-chip inline-flex items-center gap-2 px-6 py-3 text-sm font-sans font-medium text-foreground hover:translate-y-[-1px] transition-all">
            Browse datasets <ArrowRight size={14} />
          </Link>
          <Link to="/collaborate" className="glass-chip inline-flex items-center gap-2 px-6 py-3 text-sm font-sans text-muted-foreground hover:text-foreground transition-all">
            Research collaboration
          </Link>
        </div>
      </section>
    </div>
  );
};

export default HomePage;
