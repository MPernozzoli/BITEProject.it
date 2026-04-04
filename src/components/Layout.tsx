import { ReactNode, useEffect } from "react";
import { useLocation } from "react-router-dom";
import Navbar from "./Navbar";
import Footer from "./Footer";
import SeoManager from "./SeoManager";

const Layout = ({ children }: { children: ReactNode }) => {
  const { pathname } = useLocation();
  const hideNavbar = pathname === "/links";

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="site-shell min-h-screen flex flex-col">
      <SeoManager />
      <div className="site-shell__ambient" aria-hidden>
        <span className="site-shell__orb site-shell__orb--one" />
        <span className="site-shell__orb site-shell__orb--two" />
        <span className="site-shell__orb site-shell__orb--three" />
      </div>
      {hideNavbar ? null : <Navbar />}
      <main className="flex-1 relative">{children}</main>
      <Footer />
    </div>
  );
};

export default Layout;
