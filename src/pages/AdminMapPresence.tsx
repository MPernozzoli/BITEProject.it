import { ArrowLeft, MapPinned } from "lucide-react";
import { Link } from "react-router-dom";

import AdminMapPresenceManager from "@/components/admin/AdminMapPresenceManager";

const AdminMapPresence = () => {
  return (
    <div className="min-h-screen pt-24 pb-16 px-6 md:px-12">
      <div className="max-w-7xl mx-auto space-y-8">
        <section className="glass-panel rounded-[38px] px-6 py-8 md:px-10 md:py-10">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <Link
                to="/admin"
                className="glass-chip inline-flex items-center gap-2 px-4 py-2 text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground hover:text-foreground transition-colors mb-5"
              >
                <ArrowLeft size={14} />
                Dashboard
              </Link>
              <div className="glass-chip inline-flex items-center gap-2 px-4 py-2 text-[11px] font-sans uppercase tracking-[0.28em] text-muted-foreground mb-5">
                <MapPinned size={14} />
                Map trackers
              </div>
              <h1 className="editorial-heading text-4xl md:text-6xl mb-4">Tracker Mappa</h1>
              <p className="max-w-2xl text-sm md:text-base font-sans text-foreground/72 leading-relaxed">
                Gestisci barca e crew come entita separate dalle rotte. Il posizionamento avviene direttamente sulla mappa con click o drag,
                nello stesso spirito del manager waypoint.
              </p>
            </div>

            <div className="glass-panel-soft rounded-[26px] p-5 max-w-sm">
              <p className="text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground mb-2">Uso rapido</p>
              <p className="text-sm font-sans text-foreground/72 leading-relaxed">
                Seleziona un tracker, clicca su
                {" "}
                <span className="font-medium text-foreground">Posiziona sulla mappa</span>
                {" "}
                e piazzalo. Quando la crew e a bordo, il marker pubblico viene nascosto e la barca cambia icona.
              </p>
            </div>
          </div>
        </section>

        <AdminMapPresenceManager />
      </div>
    </div>
  );
};

export default AdminMapPresence;
