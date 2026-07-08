import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { getAdminUrl, shouldRedirectToAdminHostname } from "@/lib/admin-host";

const AdminRoute = ({ children }: { children: JSX.Element }) => {
  const location = useLocation();
  const { session, isAdmin, loading } = useAuth();

  if (
    typeof window !== "undefined" &&
    shouldRedirectToAdminHostname(window.location.hostname)
  ) {
    window.location.replace(getAdminUrl(`${location.pathname}${location.search}${location.hash}`));
    return null;
  }

  if (loading) {
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
