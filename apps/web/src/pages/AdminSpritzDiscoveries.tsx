import { ArrowLeft, Wine } from "lucide-react";
import { Link } from "react-router-dom";

import AdminSpritzDiscoveries from "@/components/admin/AdminSpritzDiscoveries";

const AdminSpritzDiscoveriesPage = () => {
  return (
    <div className="min-h-screen pt-24 pb-16 px-6 md:px-12">
      <div className="max-w-5xl mx-auto space-y-8">
        <section className="glass-panel rounded-[38px] px-6 py-8 md:px-10 md:py-10">
          <div className="max-w-3xl">
            <Link
              to="/admin"
              className="glass-chip inline-flex items-center gap-2 px-4 py-2 text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground hover:text-foreground transition-colors mb-5"
            >
              <ArrowLeft size={14} />
              Torna alla Dashboard
            </Link>
            <div className="glass-chip inline-flex items-center gap-2 px-4 py-2 text-[11px] font-sans uppercase tracking-[0.28em] text-muted-foreground mb-5">
              <Wine size={14} />
              Easter egg
            </div>
            <h1 className="editorial-heading text-4xl md:text-6xl mb-4">Scoperte Spritz</h1>
            <p className="max-w-2xl text-sm md:text-base font-sans text-foreground/72 leading-relaxed">
              Chi ha trovato il minigioco nascosto di S/Y Spritz digitando <span className="font-medium text-foreground">spritz</span> sul
              sito. Gli utenti loggati sono identificati dal profilo, i visitatori anonimi dalla loro chiave browser. Per ognuno viene
              registrata la data della prima apertura.
            </p>
          </div>
        </section>

        <AdminSpritzDiscoveries />
      </div>
    </div>
  );
};

export default AdminSpritzDiscoveriesPage;
