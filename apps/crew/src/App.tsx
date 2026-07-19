import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import CrewLayout from "@/components/CrewLayout";
import CrewHome from "@/pages/CrewHome";
import CrewPostPage from "@/pages/CrewPostPage";
import CrewEditor from "@/pages/CrewEditor";
import CrewLivePage from "@/pages/CrewLivePage";
import CrewPollsPage from "@/pages/CrewPollsPage";
import CrewAccountPage from "@/pages/CrewAccountPage";
import { getLoginUrl } from "@/lib/auth-redirect";

const queryClient = new QueryClient();

const LoginRedirect = ({ mode = "login" }: { mode?: "login" | "signup" }) => {
  const redirect = new URLSearchParams(window.location.search).get("redirect") || window.location.href;
  window.location.replace(getLoginUrl(redirect, mode));
  return null;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <CrewLayout>
          <Routes>
            <Route path="/" element={<CrewHome />} />
            <Route path="/post/:slug" element={<CrewPostPage />} />
            <Route path="/live" element={<CrewLivePage />} />
            <Route path="/polls" element={<CrewPollsPage />} />
            <Route path="/account" element={<CrewAccountPage />} />
            <Route path="/studio" element={<CrewEditor />} />
            <Route path="/studio/:id" element={<CrewEditor />} />
            <Route path="/login" element={<LoginRedirect />} />
            <Route path="/signup" element={<LoginRedirect mode="signup" />} />
            <Route path="/feed" element={<Navigate to="/" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </CrewLayout>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
