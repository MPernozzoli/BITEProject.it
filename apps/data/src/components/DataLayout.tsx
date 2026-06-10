import { ReactNode } from "react";
import DataNavbar from "@/components/DataNavbar";
import DataFooter from "@/components/DataFooter";

const DataLayout = ({ children }: { children: ReactNode }) => (
  <div className="min-h-screen flex flex-col">
    <DataNavbar />
    <main className="flex-1 pt-24 md:pt-28">{children}</main>
    <DataFooter />
  </div>
);

export default DataLayout;
