import { Suspense, lazy, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/lib/i18n";
import { AuthProvider } from "@/hooks/useAuth";
import Layout from "@/components/Layout";
import AdminRoute from "@/components/AdminRoute";

const createAppQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 1000 * 60 * 5,
        gcTime: 1000 * 60 * 30,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        retry: 1,
      },
    },
  });

const createAppPersister = () => {
  if (typeof window === "undefined") return null;

  return createSyncStoragePersister({
    storage: window.localStorage,
    key: "bite-query-cache-v1",
    throttleTime: 2000,
  });
};

const Index = lazy(() => import("./pages/Index"));
const TheCrew = lazy(() => import("./pages/About"));
const Manifesto = lazy(() => import("./pages/Manifesto"));
const Journal = lazy(() => import("./pages/Journal"));
const Collaborations = lazy(() => import("./pages/Collaborations"));
const Contact = lazy(() => import("./pages/Contact"));
const ArticlePage = lazy(() => import("./pages/ArticlePage"));
const AdminLogin = lazy(() => import("./pages/AdminLogin"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const ArticleEditor = lazy(() => import("./pages/ArticleEditor"));
const AdminProfile = lazy(() => import("./pages/AdminProfile"));
const UserLogin = lazy(() => import("./pages/UserLogin"));
const PublicProfile = lazy(() => import("./pages/PublicProfile"));
const StoryPage = lazy(() => import("./pages/StoryPage"));
const VoyagesPage = lazy(() => import("./pages/Voyages"));
const VoyagePage = lazy(() => import("./pages/VoyagePage"));
const Unsubscribe = lazy(() => import("./pages/Unsubscribe"));
const NewsletterConfirm = lazy(() => import("./pages/NewsletterConfirm"));
const NotFound = lazy(() => import("./pages/NotFound"));
const PrivacyPolicy = lazy(() => import("./pages/PrivacyPolicy"));
const CookiePolicy = lazy(() => import("./pages/CookiePolicy"));

const RouteFallback = () => (
  <div className="min-h-screen flex items-center justify-center pt-24">
    <p className="text-sm font-sans text-muted-foreground animate-pulse">Loading...</p>
  </div>
);

const App = () => {
  const [queryClient] = useState(createAppQueryClient);
  const [queryPersister] = useState(createAppPersister);

  const appTree = (
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <I18nProvider>
        <AuthProvider>
        <BrowserRouter>
          <Layout>
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route path="/" element={<Index />} />
                <Route path="/crew" element={<TheCrew />} />
                <Route path="/about" element={<Navigate to="/crew" replace />} />
                <Route path="/manifesto" element={<Manifesto />} />
                <Route path="/logbook" element={<Journal />} />
                <Route path="/voyages" element={<VoyagesPage />} />
                <Route path="/voyages/:voyageRef" element={<VoyagePage />} />
                <Route path="/route" element={<Navigate to="/logbook" replace />} />
                <Route path="/collaborations" element={<Collaborations />} />
                <Route path="/contact" element={<Contact />} />
                <Route path="/logbook/story/:slug" element={<StoryPage />} />
                <Route path="/logbook/:slug" element={<ArticlePage />} />
                <Route path="/profile/:id" element={<PublicProfile />} />
                <Route path="/login" element={<UserLogin />} />
                <Route path="/signup" element={<UserLogin />} />
                <Route path="/admin/login" element={<AdminLogin />} />
                <Route path="/admin" element={<AdminRoute><AdminDashboard /></AdminRoute>} />
                <Route path="/admin/article/:id" element={<AdminRoute><ArticleEditor /></AdminRoute>} />
                <Route path="/admin/profile" element={<Navigate to="/profile" replace />} />
                <Route path="/profile" element={<AdminProfile />} />
                <Route path="/unsubscribe" element={<Unsubscribe />} />
                <Route path="/newsletter/confirm" element={<NewsletterConfirm />} />
                <Route path="/privacy-policy" element={<PrivacyPolicy />} />
                <Route path="/cookie-policy" element={<CookiePolicy />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </Layout>
        </BrowserRouter>
        </AuthProvider>
      </I18nProvider>
    </TooltipProvider>
  );

  if (!queryPersister) {
    return <QueryClientProvider client={queryClient}>{appTree}</QueryClientProvider>;
  }

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: queryPersister,
        maxAge: 1000 * 60 * 60 * 24,
        dehydrateOptions: {
          shouldDehydrateQuery: (query) =>
            query.meta?.persist === true
            && query.state.status === "success"
            && query.state.data != null,
        },
      }}
      onSuccess={() => {
        void queryClient.resumePausedMutations().catch(() => undefined);
      }}
    >
      {appTree}
    </PersistQueryClientProvider>
  );
};

export default App;
