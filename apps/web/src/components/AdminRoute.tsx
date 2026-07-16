import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { getAdminUrl, shouldRedirectToAdminHostname } from "@/lib/admin-host";
import { isAdminDevBypassEnabled } from "@/lib/admin-dev-bypass";

const AdminRoute = ({ children }: { children: JSX.Element }) => {
  const location = useLocation();
  const { session, isAdmin, loading, adminLoading } = useAuth();

  if (
    typeof window !== "undefined" &&
    shouldRedirectToAdminHostname(window.location.hostname)
  ) {
    window.location.replace(getAdminUrl(`${location.pathname}${location.search}${location.hash}`));
    return null;
  }

  if (isAdminDevBypassEnabled()) {
    return (
      <>
        <div className="sticky top-0 z-[100] bg-amber-500 text-black px-4 py-1.5 text-center text-xs font-sans font-medium">
          Accesso admin bypassato in locale (VITE_ADMIN_DEV_BYPASS). Nessun permesso reale: i
          salvataggi falliranno perché RLS richiede un vero admin.
        </div>
        {children}
      </>
    );
  }

  if (loading || (session && adminLoading)) {
    return (
      <div className="min-h-screen flex items-center justify-center pt-24">
        <p className="text-sm font-sans text-muted-foreground animate-pulse">Checking access...</p>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  return children;
};

export default AdminRoute;
