import { useI18n } from "@/lib/i18n";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { MapPin, Navigation, Clock, Anchor, Ship } from "lucide-react";
import { MapContainer, TileLayer, Polyline, CircleMarker, Popup, useMap } from "react-leaflet";
import { useEffect } from "react";
import "leaflet/dist/leaflet.css";

interface RouteLeg {
  id: string;
  name: string;
  description: string;
  lat_start: number;
  lng_start: number;
  lat_end: number;
  lng_end: number;
  nautical_miles: number;
  status: "past" | "current" | "future";
  sort_order: number;
}

const FitBounds = ({ legs }: { legs: RouteLeg[] }) => {
  const map = useMap();
  useEffect(() => {
    if (!legs.length) return;
    const allPoints: [number, number][] = [];
    legs.forEach((l) => {
      if (l.lat_start && l.lng_start) allPoints.push([l.lat_start, l.lng_start]);
      if (l.lat_end && l.lng_end) allPoints.push([l.lat_end, l.lng_end]);
    });
    if (allPoints.length > 1) {
      map.fitBounds(allPoints, { padding: [40, 40] });
    } else if (allPoints.length === 1) {
      map.setView(allPoints[0], 6);
    }
  }, [legs, map]);
  return null;
};

const Route = () => {
  const { t, lang } = useI18n();

  const { data: legs = [] } = useQuery({
    queryKey: ["route-legs"],
    queryFn: async () => {
      const { data } = await supabase
        .from("route_legs" as any)
        .select("*")
        .order("sort_order", { ascending: true });
      return (data || []) as RouteLeg[];
    },
  });

  const pastLegs = legs.filter((l) => l.status === "past");
  const currentLeg = legs.find((l) => l.status === "current");
  const futureLegs = legs.filter((l) => l.status === "future");
  const totalMiles = legs.filter((l) => l.status !== "future").reduce((s, l) => s + Number(l.nautical_miles), 0);
  const plannedMiles = legs.reduce((s, l) => s + Number(l.nautical_miles), 0);

  const hasCoords = legs.some((l) => l.lat_start !== 0 || l.lng_start !== 0);

  // Build polyline segments
  const buildSegments = (subset: RouteLeg[]): [number, number][][] => {
    return subset
      .filter((l) => l.lat_start !== 0 || l.lng_start !== 0)
      .map((l) => [[l.lat_start, l.lng_start], [l.lat_end, l.lng_end]]);
  };

  return (
    <div>
      {/* Header */}
      <section className="pt-32 pb-12 md:pt-40 md:pb-16 px-6 md:px-12">
        <div className="page-section-wide">
          <h1 className="editorial-heading text-4xl md:text-6xl lg:text-7xl mb-4">
            {t("route.page.title")}
          </h1>
          <p className="editorial-body text-lg text-muted-foreground max-w-2xl">
            {t("route.page.subtitle")}
          </p>
        </div>
      </section>

      {/* Stats */}
      <section className="px-6 md:px-12 pb-8">
        <div className="page-section-wide">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="border border-border p-6">
              <Ship size={18} className="text-accent mb-3" />
              <p className="text-[10px] font-sans tracking-[0.2em] uppercase text-muted-foreground mb-1">
                {lang === "it" ? "Miglia percorse" : "Miles Sailed"}
              </p>
              <p className="editorial-heading text-2xl">{totalMiles.toLocaleString()} <span className="text-sm text-muted-foreground">NM</span></p>
            </div>
            <div className="border border-border p-6">
              <Navigation size={18} className="text-accent mb-3" />
              <p className="text-[10px] font-sans tracking-[0.2em] uppercase text-muted-foreground mb-1">
                {lang === "it" ? "Tratte completate" : "Legs Completed"}
              </p>
              <p className="editorial-heading text-2xl">{pastLegs.length}</p>
            </div>
            <div className="border border-border p-6">
              <MapPin size={18} className="text-accent mb-3" />
              <p className="text-[10px] font-sans tracking-[0.2em] uppercase text-muted-foreground mb-1">
                {lang === "it" ? "Posizione attuale" : "Current Location"}
              </p>
              <p className="editorial-heading text-lg">{currentLeg?.name || "—"}</p>
            </div>
            <div className="border border-border p-6">
              <Clock size={18} className="text-accent mb-3" />
              <p className="text-[10px] font-sans tracking-[0.2em] uppercase text-muted-foreground mb-1">
                {lang === "it" ? "Prossima tappa" : "Next Stop"}
              </p>
              <p className="editorial-heading text-lg">{futureLegs[0]?.name || "—"}</p>
            </div>
          </div>

          {/* Miles progress bar */}
          {plannedMiles > 0 && (
            <div className="mt-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-sans text-muted-foreground">
                  {lang === "it" ? "Progresso viaggio" : "Voyage Progress"}
                </span>
                <span className="text-xs font-sans text-accent">
                  {totalMiles.toLocaleString()} / {plannedMiles.toLocaleString()} NM ({Math.round((totalMiles / plannedMiles) * 100)}%)
                </span>
              </div>
              <div className="w-full h-2 bg-muted overflow-hidden">
                <div
                  className="h-full bg-accent transition-all duration-1000"
                  style={{ width: `${Math.min((totalMiles / plannedMiles) * 100, 100)}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Interactive Map */}
      <section className="px-6 md:px-12 pb-12">
        <div className="page-section-wide">
          {hasCoords ? (
            <div className="aspect-[21/9] border border-border overflow-hidden">
              <MapContainer
                center={[40, 15]}
                zoom={5}
                style={{ height: "100%", width: "100%" }}
                scrollWheelZoom={false}
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
                  url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                />
                <FitBounds legs={legs} />

                {/* Past legs - solid dark line */}
                {buildSegments(pastLegs).map((seg, i) => (
                  <Polyline key={`past-${i}`} positions={seg} pathOptions={{ color: "hsl(220, 40%, 15%)", weight: 3, opacity: 0.7 }} />
                ))}

                {/* Current leg - accent color, thicker */}
                {currentLeg && currentLeg.lat_start !== 0 && (
                  <Polyline
                    positions={[[currentLeg.lat_start, currentLeg.lng_start], [currentLeg.lat_end, currentLeg.lng_end]]}
                    pathOptions={{ color: "hsl(180, 20%, 35%)", weight: 4, opacity: 1 }}
                  />
                )}

                {/* Future legs - dashed */}
                {buildSegments(futureLegs).map((seg, i) => (
                  <Polyline key={`future-${i}`} positions={seg} pathOptions={{ color: "hsl(220, 10%, 46%)", weight: 2, opacity: 0.5, dashArray: "8 6" }} />
                ))}

                {/* Waypoints */}
                {legs.filter((l) => l.lat_start !== 0 || l.lng_start !== 0).map((l, i) => (
                  <CircleMarker
                    key={`start-${l.id}`}
                    center={[l.lat_start, l.lng_start]}
                    radius={l.status === "current" ? 6 : 4}
                    pathOptions={{
                      fillColor: l.status === "current" ? "hsl(180, 20%, 35%)" : l.status === "past" ? "hsl(220, 40%, 15%)" : "hsl(220, 10%, 70%)",
                      fillOpacity: 1,
                      color: "white",
                      weight: 2,
                    }}
                  >
                    <Popup>
                      <strong>{l.name}</strong>
                      {l.nautical_miles > 0 && <><br />{Number(l.nautical_miles)} NM</>}
                      {l.description && <><br /><span style={{ fontSize: "12px" }}>{l.description}</span></>}
                    </Popup>
                  </CircleMarker>
                ))}

                {/* Last endpoint */}
                {legs.length > 0 && (() => {
                  const last = legs[legs.length - 1];
                  if (last.lat_end === 0 && last.lng_end === 0) return null;
                  return (
                    <CircleMarker
                      center={[last.lat_end, last.lng_end]}
                      radius={4}
                      pathOptions={{ fillColor: "hsl(220, 10%, 70%)", fillOpacity: 1, color: "white", weight: 2 }}
                    />
                  );
                })()}
              </MapContainer>
            </div>
          ) : (
            <div className="aspect-[21/9] bg-muted flex items-center justify-center border border-border">
              <div className="text-center">
                <Anchor size={48} className="text-muted-foreground/30 mx-auto mb-4" />
                <p className="text-muted-foreground font-sans">
                  {lang === "it" ? "La mappa apparirà quando verranno aggiunte le coordinate" : "Map will appear when coordinates are added"}
                </p>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Route Timeline */}
      <section className="page-section bg-salt-warm">
        <div className="page-section-narrow">
          {/* Current */}
          {currentLeg && (
            <div className="mb-16">
              <h2 className="editorial-heading text-3xl md:text-4xl mb-8">
                {lang === "it" ? "Tratta attuale" : "Current Leg"}
              </h2>
              <div className="border-2 border-accent p-8">
                <div className="flex items-start gap-4">
                  <Navigation size={20} className="text-accent mt-1 flex-shrink-0" />
                  <div>
                    <h3 className="editorial-heading text-2xl mb-2">{currentLeg.name}</h3>
                    {currentLeg.description && <p className="text-muted-foreground mb-3">{currentLeg.description}</p>}
                    {Number(currentLeg.nautical_miles) > 0 && (
                      <span className="text-sm font-sans text-accent">{Number(currentLeg.nautical_miles)} NM</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Past */}
          {pastLegs.length > 0 && (
            <div className="mb-16">
              <h2 className="editorial-heading text-3xl md:text-4xl mb-8">
                {t("route.past.title")}
              </h2>
              <div className="space-y-0">
                {pastLegs.map((leg, i) => (
                  <div key={leg.id} className="flex gap-6 py-5 border-b border-border last:border-0">
                    <span className="text-xs font-sans text-muted-foreground/40 pt-1 w-8 shrink-0">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div className="flex-1">
                      <h3 className="editorial-heading text-lg mb-1">{leg.name}</h3>
                      {leg.description && <p className="text-sm text-muted-foreground">{leg.description}</p>}
                    </div>
                    {Number(leg.nautical_miles) > 0 && (
                      <span className="text-xs font-sans text-muted-foreground shrink-0 pt-1">{Number(leg.nautical_miles)} NM</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Future */}
          {futureLegs.length > 0 && (
            <div>
              <h2 className="editorial-heading text-3xl md:text-4xl mb-8">
                {t("route.future.title")}
              </h2>
              <div className="space-y-0">
                {futureLegs.map((leg) => (
                  <div key={leg.id} className="flex gap-6 py-5 border-b border-border/50 last:border-0">
                    <span className="text-xs font-sans text-accent pt-1 w-8 shrink-0">→</span>
                    <div className="flex-1">
                      <h3 className="editorial-heading text-lg mb-1">{leg.name}</h3>
                      {leg.description && <p className="text-sm text-muted-foreground">{leg.description}</p>}
                    </div>
                    {Number(leg.nautical_miles) > 0 && (
                      <span className="text-xs font-sans text-muted-foreground shrink-0 pt-1">{Number(leg.nautical_miles)} NM</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Empty state */}
          {legs.length === 0 && (
            <div className="text-center py-20">
              <Anchor size={48} className="text-muted-foreground/20 mx-auto mb-4" />
              <p className="text-muted-foreground">
                {lang === "it" ? "Il viaggio non è ancora iniziato..." : "The voyage hasn't started yet..."}
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

export default Route;
