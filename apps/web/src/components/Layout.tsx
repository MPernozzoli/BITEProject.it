import { ReactNode, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { stripLangPrefix } from "@/lib/seo";
import AdminMobileNavigation from "@/components/admin/AdminMobileNavigation";
import Navbar from "./Navbar";
import Footer from "./Footer";
import SeoManager from "./SeoManager";

const Layout = ({ children }: { children: ReactNode }) => {
  const { pathname } = useLocation();
  const { isAdmin } = useAuth();
  const isMobile = useIsMobile();
  const strippedPath = stripLangPrefix(pathname);
  const hideNavbar = strippedPath === "/links";
  const isLogbookIndex = strippedPath === "/logbook";
  const hideFooter = isLogbookIndex;
  const hideFooterMobileLogbook = isLogbookIndex && isMobile;
  const showAdminMobileNavigation =
    isAdmin && (pathname === "/profile" || pathname === "/admin" || pathname.startsWith("/admin/"));

  useEffect(() => {
    // Su /logbook la pagina gestisce overflow (mappa a tutto schermo); reset qui annullerebbe quel lock.
    if (!isLogbookIndex) {
      document.body.style.overflow = "";
      document.documentElement.style.overflow = "";
    }
    window.scrollTo(0, 0);
  }, [pathname, isLogbookIndex]);

  return (
    <div
      className={cn(
        "site-shell min-h-[100dvh] flex flex-col",
        hideFooterMobileLogbook && "max-md:min-h-0",
      )}
    >
      <SeoManager />
      {hideFooterMobileLogbook ? null : (
        <div className="site-shell__ambient" aria-hidden>
          <span className="site-shell__orb site-shell__orb--one" />
          <span className="site-shell__orb site-shell__orb--two" />
          <span className="site-shell__orb site-shell__orb--three" />
        </div>
      )}
      {hideNavbar ? null : <Navbar />}
      <main
        className={cn(
          "flex-1 relative",
          hideFooterMobileLogbook && "max-md:min-h-0 max-md:flex-1",
          showAdminMobileNavigation && "max-md:pb-24",
        )}
      >
        {children}
      </main>
      {showAdminMobileNavigation ? <AdminMobileNavigation /> : null}
      {hideFooter ? null : <Footer />}
    </div>
  );
};

export default Layout;
