import { Suspense, lazy } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

const AdminCommunityManager = lazy(() => import("@/components/admin/AdminCommunityManager"));

const AdminCommunityPage = () => {
  return (
    <div className="min-h-screen pt-24 pb-16 px-6 md:px-12">
      <div className="max-w-6xl mx-auto space-y-6">
        <Link
          to="/admin"
          className="glass-chip inline-flex items-center gap-2 px-4 py-2 text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={14} />
          Torna alla Dashboard
        </Link>

        <section className="glass-panel rounded-[34px] p-5 md:p-6 lg:p-8 space-y-5">
          <div>
            <p className="text-[11px] font-sans uppercase tracking-[0.28em] text-muted-foreground mb-2">Crew community</p>
            <h1 className="editorial-heading text-3xl md:text-4xl">Community</h1>
          </div>
          <Suspense fallback={<div className="glass-panel-soft rounded-[28px] p-8 text-muted-foreground">Loading community manager...</div>}>
            <AdminCommunityManager />
          </Suspense>
        </section>
      </div>
    </div>
  );
};

export default AdminCommunityPage;
