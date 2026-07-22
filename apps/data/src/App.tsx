import { Suspense, lazy } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import DataLayout from "@/components/DataLayout";

const queryClient = new QueryClient();

const MapPage = lazy(() => import("./pages/MapPage"));
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

const LoginRedirect = ({ mode = "login" }: { mode?: "login" | "signup" }) => {
  const localHostnames = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);
  const configuredLoginUrl = import.meta.env.VITE_LOGIN_URL;
  const loginOrigin = configuredLoginUrl
    ? configuredLoginUrl.replace(/\/$/, "")
    : localHostnames.has(window.location.hostname)
      ? "http://127.0.0.1:5173"
      : `${window.location.protocol}//login.biteproject.it`;
  const target = new URL(mode === "signup" ? "/signup" : "/login", loginOrigin);
  target.pathname = mode === "signup" ? "/signup" : "/login";
  target.searchParams.set("redirect", window.location.href);
  window.location.replace(target.toString());
  return null;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AppErrorBoundary>
          <DataLayout>
            <Suspense fallback={<Loading />}>
              <Routes>
                {/* The data is the homepage: a data portal opens on its data. */}
                <Route path="/" element={<MapPage />} />
                <Route path="/methodology" element={<MethodologyPage />} />
                <Route path="/sensors" element={<SensorsPage />} />
                <Route path="/downloads" element={<DownloadsPage />} />
                <Route path="/collaborate" element={<CollaboratePage />} />
                <Route path="/contact" element={<ContactRedirect />} />
                <Route path="/login" element={<LoginRedirect />} />
                <Route path="/signup" element={<LoginRedirect mode="signup" />} />

                {/* Retired routes. A dataset URL a researcher saved has to keep resolving,
                    so these redirect rather than 404. */}
                <Route path="/map" element={<Navigate to="/" replace />} />
                <Route path="/data" element={<Navigate to="/" replace />} />
                <Route path="/missions" element={<Navigate to="/" replace />} />
                <Route path="/about" element={<Navigate to="/methodology" replace />} />

                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </DataLayout>
        </AppErrorBoundary>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
