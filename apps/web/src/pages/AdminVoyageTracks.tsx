import { ArrowLeft, Route } from "lucide-react";
import { Link } from "react-router-dom";

import VoyageTracksManager from "@/components/admin/VoyageTracksManager";

const AdminVoyageTracks = () => {
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
                Torna alla Dashboard
              </Link>
              <div className="glass-chip inline-flex items-center gap-2 px-4 py-2 text-[11px] font-sans uppercase tracking-[0.28em] text-muted-foreground mb-5">
                <Route size={14} />
                Tracciati GPX
              </div>
              <h1 className="editorial-heading text-4xl md:text-6xl mb-4">Rotta reale</h1>
              <p className="max-w-2xl text-sm md:text-base font-sans text-foreground/72 leading-relaxed">
                Carica i GPX registrati a bordo. Il sistema trova da solo soste e passaggi vicino alle tappe e propone quali tratte copre ogni
                tracciato; tu confermi o correggi. Le miglia e la rotta reali finiscono nel biglietto ricordo e nel confronto previsto/effettivo
                della pagina viaggio.
              </p>
            </div>

            <div className="glass-panel-soft rounded-[26px] p-5 max-w-sm">
              <p className="text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground mb-2">Da sapere</p>
              <p className="text-sm font-sans text-foreground/72 leading-relaxed">
                Il tracciato è documentale: non cambia orari registrati, prenotazioni né notifiche. Un file può coprire più tratte e una tratta può
                avere più file. Solo i tracciati <span className="font-medium text-foreground">confermati</span> sono pubblici.
              </p>
            </div>
          </div>
        </section>

        <VoyageTracksManager />
      </div>
    </div>
  );
};

export default AdminVoyageTracks;
