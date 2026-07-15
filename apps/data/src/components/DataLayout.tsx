import { ReactNode } from "react";
import DataNavbar from "@/components/DataNavbar";
import DataFooter from "@/components/DataFooter";

// Same shell as the main site's Layout: the ambient orbs are what give biteproject.it
// its depth, and without them the portal reads as a different product on the same palette.
const DataLayout = ({ children }: { children: ReactNode }) => (
  <div className="site-shell min-h-[100dvh] flex flex-col">
    <div className="site-shell__ambient" aria-hidden>
      <span className="site-shell__orb site-shell__orb--one" />
      <span className="site-shell__orb site-shell__orb--two" />
      <span className="site-shell__orb site-shell__orb--three" />
    </div>
    <DataNavbar />
    <main className="flex-1 relative pt-24 md:pt-28">{children}</main>
    <DataFooter />
  </div>
);

export default DataLayout;
