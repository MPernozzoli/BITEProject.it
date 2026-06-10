import MissionCard from "@/components/data/MissionCard";
import { useVoyages, useAllWaypoints, formatDateRange } from "@/hooks/use-voyages";

const MissionsPage = () => {
  const { data: voyages = [], isLoading } = useVoyages();
  const { data: waypoints = [] } = useAllWaypoints();

  const waterVoyages = voyages.filter(v => v.type === "water");

  const statusSummary = [
    { status: "completed" as const, count: waterVoyages.filter(v => v.status === "completed").length, color: "bg-data-green" },
    { status: "active" as const, count: waterVoyages.filter(v => v.status === "active").length, color: "bg-data-blue" },
    { status: "planned" as const, count: waterVoyages.filter(v => v.status === "planned").length, color: "bg-muted-foreground/40" },
  ];

  return (
    <div>
      <section className="page-section page-section-wide">
        <div className="mb-8">
          <h1 className="editorial-heading text-4xl text-foreground mb-3">Missions & Voyages</h1>
          <p className="font-sans text-muted-foreground max-w-2xl">
            Each mission corresponds to a voyage or route segment during which environmental data was actively collected aboard Spritz. Missions are organized chronologically and linked to their associated datasets.
          </p>
        </div>

        {/* Status summary */}
        <div className="flex flex-wrap gap-3 mb-8">
          {statusSummary.map((s) => (
            <div key={s.status} className="glass-chip inline-flex items-center gap-2 px-4 py-2 text-xs font-sans">
              <span className={`h-2 w-2 rounded-full ${s.color}`} />
              <span className="capitalize text-muted-foreground">{s.status}</span>
              <span className="font-medium text-foreground">{s.count}</span>
            </div>
          ))}
        </div>

        {isLoading ? (
          <div className="text-center py-12">
            <p className="text-sm font-sans text-muted-foreground animate-pulse">Loading missions...</p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {waterVoyages.map((v) => (
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
        )}
      </section>
    </div>
  );
};

export default MissionsPage;
