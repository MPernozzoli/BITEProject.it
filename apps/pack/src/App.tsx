import { Suspense, lazy } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { currentLanguage } from "@/data/site";

const Index = lazy(() => import("./pages/Index.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));

const queryClient = new QueryClient();

document.documentElement.lang = currentLanguage;

const Loading = () => (
  <div className="min-h-screen bg-background" aria-label="Loading" />
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
          <Suspense fallback={<Loading />}>
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/login" element={<LoginRedirect />} />
              <Route path="/signup" element={<LoginRedirect mode="signup" />} />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </AppErrorBoundary>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
