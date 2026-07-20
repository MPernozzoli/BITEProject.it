import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Edit, MapPinned } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { isAuthFailureError } from "@/lib/supabase-auth";

const AdminVoyageManager = lazy(() => import("@/components/admin/AdminVoyageManager"));

interface VoyageSummary {
  id: string;
  name: string;
  name_en: string | null;
  name_it: string | null;
  type: "water" | "land";
  status: string;
  is_published: boolean;
  sort_order: number;
}

const AdminRoutes = () => {
  const navigate = useNavigate();
  const [voyages, setVoyages] = useState<VoyageSummary[]>([]);
  const [routeLeaveGuard, setRouteLeaveGuard] = useState<null | (() => Promise<boolean>)>(null);
  const [selectedVoyageId, setSelectedVoyageId] = useState<string | null>(null);
  const [requestEditVoyageId, setRequestEditVoyageId] = useState<string | null>(null);

  const fetchVoyages = useCallback(async () => {
    const { data, error } = await supabase
      .from("voyages")
      .select("id,name,name_en,name_it,type,status,is_published,sort_order")
      .order("sort_order", { ascending: true });
    if (error && isAuthFailureError(error)) {
      await supabase.auth.signOut();
      navigate("/login", { state: { from: "/admin/route" } });
      return;
    }
    if (data) setVoyages(data as VoyageSummary[]);
  }, [navigate]);

  useEffect(() => {
    void fetchVoyages();
  }, [fetchVoyages]);

  useEffect(() => {
    if (!selectedVoyageId && voyages[0]?.id) {
      setSelectedVoyageId(voyages[0].id);
    }
  }, [selectedVoyageId, voyages]);

  const runRouteLeaveGuard = useCallback(async () => {
    if (!routeLeaveGuard) return true;
    return routeLeaveGuard();
  }, [routeLeaveGuard]);

  return (
    <div className="min-h-screen pt-24 pb-16 px-6 md:px-12">
      <div className="max-w-7xl mx-auto space-y-6">
        <Link
          to="/admin"
          onClick={(event) => {
            event.preventDefault();
            void (async () => {
              if (!(await runRouteLeaveGuard())) return;
              navigate("/admin");
            })();
          }}
          className="glass-chip inline-flex items-center gap-2 px-4 py-2 text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={14} />
          Torna alla Dashboard
        </Link>

        <section className="glass-panel rounded-[34px] px-5 py-6 md:px-8 md:py-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-[11px] font-sans uppercase tracking-[0.28em] text-muted-foreground mb-2">Voyage map</p>
              <h1 className="editorial-heading text-3xl md:text-5xl">Rotte</h1>
            </div>
            <Link
              to="/admin/trackers"
              onClick={(event) => {
                event.preventDefault();
                void (async () => {
                  if (!(await runRouteLeaveGuard())) return;
                  navigate("/admin/trackers");
                })();
              }}
              className="glass-chip inline-flex items-center gap-2 px-4 py-2.5 text-sm font-sans text-foreground hover:text-accent transition-colors"
            >
              <MapPinned size={16} />
              Apri tracker mappa
            </Link>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-[0.85fr_2.15fr]">
          <aside className="glass-panel rounded-[30px] p-5 md:p-6 h-fit space-y-3">
            <p className="text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground mb-1">Rotte in mappa</p>
            <div className="space-y-2 max-h-[420px] overflow-y-auto">
              {voyages.length === 0 ? (
                <p className="text-xs font-sans text-muted-foreground">Nessuna rotta disponibile.</p>
              ) : (
                voyages.map((voyage) => {
                  const displayName = voyage.name_it || voyage.name_en || voyage.name || "Untitled voyage";
                  return (
                    <div key={voyage.id} className="flex items-stretch gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          void (async () => {
                            if (!(await runRouteLeaveGuard())) return;
                            setSelectedVoyageId(voyage.id);
                          })();
                        }}
                        className={`flex-1 min-w-0 rounded-[18px] border px-3 py-2 text-left transition-colors ${
                          selectedVoyageId === voyage.id
                            ? "border-accent bg-accent/10"
                            : "border-border/70 bg-background/40 hover:border-accent/50"
                        }`}
                      >
                        <span className="block text-sm font-sans text-foreground truncate">{displayName}</span>
                        <span className="mt-1 block text-[10px] font-sans uppercase tracking-[0.18em] text-muted-foreground">
                          {voyage.type} · {voyage.status}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setRequestEditVoyageId(voyage.id)}
                        className="shrink-0 self-stretch inline-flex items-center justify-center rounded-[18px] border border-border/70 bg-background/80 px-2.5 text-muted-foreground hover:border-accent hover:text-foreground transition-colors"
                        title="Modifica nome e dettagli rotta"
                        aria-label="Modifica info rotta"
                      >
                        <Edit size={14} />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </aside>

          <main className="glass-panel rounded-[34px] p-5 md:p-6 lg:p-8">
            <Suspense fallback={<div className="glass-panel-soft rounded-[28px] p-8 text-muted-foreground">Loading route manager...</div>}>
              <AdminVoyageManager
                onRegisterLeaveGuard={(guard) => setRouteLeaveGuard(() => guard)}
                selectedVoyageId={selectedVoyageId}
                onSelectedVoyageIdChange={setSelectedVoyageId}
                requestEditVoyageId={requestEditVoyageId}
                onRequestEditVoyageConsumed={() => setRequestEditVoyageId(null)}
              />
            </Suspense>
          </main>
        </section>
      </div>
    </div>
  );
};

export default AdminRoutes;
