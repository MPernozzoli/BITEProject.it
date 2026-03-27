import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/lib/i18n";
import { AuthProvider } from "@/hooks/useAuth";
import Layout from "@/components/Layout";
import Index from "./pages/Index";
import TheCrew from "./pages/About";
import { Navigate } from "react-router-dom";
import Manifesto from "./pages/Manifesto";
import Journal from "./pages/Journal";

import Collaborations from "./pages/Collaborations";
import Contact from "./pages/Contact";
import ArticlePage from "./pages/ArticlePage";
import AdminLogin from "./pages/AdminLogin";
import AdminDashboard from "./pages/AdminDashboard";
import ArticleEditor from "./pages/ArticleEditor";
import AdminProfile from "./pages/AdminProfile";
import UserLogin from "./pages/UserLogin";
import PublicProfile from "./pages/PublicProfile";
import StoryPage from "./pages/StoryPage";
import Unsubscribe from "./pages/Unsubscribe";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <I18nProvider>
        <AuthProvider>
        <BrowserRouter>
          <Layout>
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/crew" element={<TheCrew />} />
              <Route path="/about" element={<Navigate to="/crew" replace />} />
              <Route path="/manifesto" element={<Manifesto />} />
              <Route path="/logbook" element={<Journal />} />
              <Route path="/route" element={<Navigate to="/logbook" replace />} />
              <Route path="/collaborations" element={<Collaborations />} />
              <Route path="/contact" element={<Contact />} />
              <Route path="/logbook/story/:slug" element={<StoryPage />} />
              <Route path="/logbook/:slug" element={<ArticlePage />} />
              <Route path="/profile/:id" element={<PublicProfile />} />
              <Route path="/login" element={<UserLogin />} />
              <Route path="/admin/login" element={<AdminLogin />} />
              <Route path="/admin" element={<AdminDashboard />} />
              <Route path="/admin/article/:id" element={<ArticleEditor />} />
              <Route path="/admin/profile" element={<Navigate to="/profile" replace />} />
              <Route path="/profile" element={<AdminProfile />} />
              <Route path="/unsubscribe" element={<Unsubscribe />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Layout>
        </BrowserRouter>
        </AuthProvider>
      </I18nProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
