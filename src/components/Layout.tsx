import { ReactNode, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import Navbar from "./Navbar";
import Footer from "./Footer";
import SeoManager from "./SeoManager";

const Layout = ({ children }: { children: ReactNode }) => {
  const { pathname } = useLocation();
  const isMobile = useIsMobile();
  const hideNavbar = pathname === "/links";
  const isLogbookIndex = pathname === "/logbook";
  const hideFooterMobileLogbook = isLogbookIndex && isMobile;

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
        )}
      >
        {children}
      </main>
      {hideFooterMobileLogbook ? null : <Footer />}
    </div>
  );
};

export default Layout;
