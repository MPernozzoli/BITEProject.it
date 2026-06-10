import { Suspense, lazy } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import DataLayout from "@/components/DataLayout";

const queryClient = new QueryClient();

const HomePage = lazy(() => import("./pages/HomePage"));
const AboutPage = lazy(() => import("./pages/AboutPage"));
const DataExplorerPage = lazy(() => import("./pages/DataExplorerPage"));
const MapPage = lazy(() => import("./pages/MapPage"));
const MissionsPage = lazy(() => import("./pages/MissionsPage"));
const SensorsPage = lazy(() => import("./pages/SensorsPage"));
const MethodologyPage = lazy(() => import("./pages/MethodologyPage"));
const DownloadsPage = lazy(() => import("./pages/DownloadsPage"));
const CollaboratePage = lazy(() => import("./pages/CollaboratePage"));
const ContactRedirect = lazy(() => import("./pages/ContactRedirect"));
const NotFound = lazy(() => import("./pages/NotFound"));

const Loading = () => (
  <div className="min-h-[50vh] flex items-center justify-center">
    <p className="text-sm font-sans text-muted-foreground animate-pulse">Loading...</p>
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <DataLayout>
          <Suspense fallback={<Loading />}>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/about" element={<AboutPage />} />
              <Route path="/data" element={<DataExplorerPage />} />
              <Route path="/map" element={<MapPage />} />
              <Route path="/missions" element={<MissionsPage />} />
              <Route path="/sensors" element={<SensorsPage />} />
              <Route path="/methodology" element={<MethodologyPage />} />
              <Route path="/downloads" element={<DownloadsPage />} />
              <Route path="/collaborate" element={<CollaboratePage />} />
              <Route path="/contact" element={<ContactRedirect />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </DataLayout>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
