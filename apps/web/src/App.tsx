import { Suspense, lazy, useState } from "react";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { I18nProvider } from "@/lib/i18n";
import { AuthProvider } from "@/hooks/useAuth";
import Layout from "@/components/Layout";
import AdminRoute from "@/components/AdminRoute";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { LegacyLangRedirect } from "@/components/LegacyLangRedirect";
import {
  LegacyVoyageRedirect,
  LegacyArticleRedirect,
  LegacyStoryRedirect,
} from "@/components/LegacyLangRedirect";
import { getMainSiteUrl, isCurrentAdminHostname } from "@/lib/admin-host";
import { detectPreferredLang, withLang } from "@/lib/seo";

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
const AdminMapPresence = lazy(() => import("./pages/AdminMapPresence"));
const AdminSpritzDiscoveries = lazy(() => import("./pages/AdminSpritzDiscoveries"));
const AdminMedia = lazy(() => import("./pages/AdminMedia"));
const AdminLogbookPoints = lazy(() => import("./pages/AdminLogbookPoints"));
const AdminPackGallery = lazy(() => import("./pages/AdminPackGallery"));
const AdminMail = lazy(() => import("./pages/AdminMail"));
const AdminVoyageBookings = lazy(() => import("./pages/AdminVoyageBookings"));
const ArticleEditor = lazy(() => import("./pages/ArticleEditor"));
const AdminProfile = lazy(() => import("./pages/AdminProfile"));
const UserLogin = lazy(() => import("./pages/UserLogin"));
const CompleteProfile = lazy(() => import("./pages/CompleteProfile"));
const UserBookings = lazy(() => import("./pages/UserBookings"));
const ManageBookingParticipants = lazy(() => import("./pages/ManageBookingParticipants"));
const PublicProfile = lazy(() => import("./pages/PublicProfile"));
const StoryPage = lazy(() => import("./pages/StoryPage"));
const VoyagesPage = lazy(() => import("./pages/Voyages"));
const VoyagePage = lazy(() => import("./pages/VoyagePage"));
const LinksPage = lazy(() => import("./pages/Links"));
const Unsubscribe = lazy(() => import("./pages/Unsubscribe"));
const NewsletterConfirm = lazy(() => import("./pages/NewsletterConfirm"));
const NotFound = lazy(() => import("./pages/NotFound"));
const PrivacyPolicy = lazy(() => import("./pages/PrivacyPolicy"));
const CookiePolicy = lazy(() => import("./pages/CookiePolicy"));

const RouteFallback = () => (
  <div className="min-h-screen bg-background" aria-hidden="true" />
);

/** Root redirect: / → /it or /en based on persisted preference / browser. */
const RootLangRedirect = () => {
  const location = useLocation();
  if (isCurrentAdminHostname()) {
    return <Navigate to="/admin" replace />;
  }

  const lang = detectPreferredLang();
  return <Navigate to={withLang(lang, "/") + location.search + location.hash} replace />;
};

/** Keeps public/marketing routes off the admin subdomain (e.g. admin.biteproject.it/logbook). */
const RequireMainHost = () => {
  if (isCurrentAdminHostname()) {
    return <Navigate to="/admin" replace />;
  }

  return <Outlet />;
};

/**
 * Sends auth/WebAuthn-sensitive routes to the main site when reached from the admin subdomain.
 * Passkey registration/sign-in must happen from an origin allowed by Supabase's RP configuration.
 * Uses a hard redirect since it crosses hostnames.
 */
const RequireMainHostForAuth = ({ children }: { children: JSX.Element }) => {
  const location = useLocation();

  if (isCurrentAdminHostname()) {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(location.search);
      const stateRedirect = (location.state as { from?: string } | null)?.from;

      if (!params.has("redirect") && stateRedirect?.startsWith("/") && !stateRedirect.startsWith("//")) {
        params.set("redirect", stateRedirect);
      }

      const search = params.toString();
      window.location.replace(
        getMainSiteUrl(`${location.pathname}${search ? `?${search}` : ""}${location.hash}`),
      );
    }
    return null;
  }

  return children;
};

/** Localized routes used identically under /it and /en prefixes. */
const LocalizedRoutes = () => (
  <Routes>
    <Route index element={<Index />} />
    <Route path="crew" element={<TheCrew />} />
    <Route path="manifesto" element={<Manifesto />} />
    <Route path="logbook" element={<Journal />} />
    <Route path="voyages" element={<VoyagesPage />} />
    <Route path="voyages/:voyageRef" element={<VoyagePage />} />
    <Route path="links" element={<LinksPage />} />
    <Route path="collaborations" element={<Collaborations />} />
    <Route path="contact" element={<Contact />} />
    <Route path="logbook/story/:slug" element={<StoryPage />} />
    <Route path="logbook/:slug" element={<ArticlePage />} />
    <Route path="*" element={<NotFound />} />
  </Routes>
);

const App = () => {
  const [queryClient] = useState(createAppQueryClient);
  const [queryPersister] = useState(createAppPersister);

  const appTree = (
    <>
      <Toaster />
      <Sonner />
      <Analytics />
      <SpeedInsights />
      <BrowserRouter>
        <I18nProvider>
          <AuthProvider>
            <AppErrorBoundary>
              <Layout>
                <Suspense fallback={<RouteFallback />}>
                  <Routes>
                    {/* Root → redirect to /it or /en based on user preference (or /admin on the admin subdomain) */}
                    <Route path="/" element={<RootLangRedirect />} />

                    {/* Marketing/public site — kept off the admin subdomain */}
                    <Route element={<RequireMainHost />}>
                      {/* Localized public routes under /it and /en */}
                      <Route path="/it/*" element={<LocalizedRoutes />} />
                      <Route path="/en/*" element={<LocalizedRoutes />} />

                      {/* Legacy URL redirects → preserve external/social links */}
                      <Route path="/about" element={<LegacyLangRedirect to="/crew" />} />
                      <Route path="/crew" element={<LegacyLangRedirect to="/crew" />} />
                      <Route path="/manifesto" element={<LegacyLangRedirect to="/manifesto" />} />
                      <Route path="/logbook" element={<LegacyLangRedirect to="/logbook" />} />
                      <Route path="/voyages" element={<LegacyLangRedirect to="/voyages" />} />
                      <Route path="/voyages/:voyageRef" element={<LegacyVoyageRedirect />} />
                      <Route path="/logbook/story/:slug" element={<LegacyStoryRedirect />} />
                      <Route path="/logbook/:slug" element={<LegacyArticleRedirect />} />
                      <Route path="/links" element={<LegacyLangRedirect to="/links" />} />
                      <Route path="/linktree" element={<LegacyLangRedirect to="/links" />} />
                      <Route path="/route" element={<LegacyLangRedirect to="/logbook" />} />
                      <Route path="/collaborations" element={<LegacyLangRedirect to="/collaborations" />} />
                      <Route path="/contact" element={<LegacyLangRedirect to="/contact" />} />

                      <Route path="/profile/:id" element={<PublicProfile />} />
                      <Route path="/bookings" element={<UserBookings />} />
                    <Route path="/bookings/:id/participants" element={<ManageBookingParticipants />} />
                      <Route path="/unsubscribe" element={<Unsubscribe />} />
                      <Route path="/newsletter/confirm" element={<NewsletterConfirm />} />
                      <Route path="/privacy-policy" element={<PrivacyPolicy />} />
                      <Route path="/cookie-policy" element={<CookiePolicy />} />
                      <Route path="*" element={<NotFound />} />
                    </Route>

                    {/* Auth and admin routes — login/profile flows are forced onto the main site for WebAuthn. */}
                    <Route
                      path="/login"
                      element={
                        <RequireMainHostForAuth>
                          <UserLogin />
                        </RequireMainHostForAuth>
                      }
                    />
                    <Route
                      path="/signup"
                      element={
                        <RequireMainHostForAuth>
                          <UserLogin />
                        </RequireMainHostForAuth>
                      }
                    />
                    <Route
                      path="/complete-profile"
                      element={
                        <RequireMainHostForAuth>
                          <CompleteProfile />
                        </RequireMainHostForAuth>
                      }
                    />
                    <Route path="/admin/login" element={<AdminLogin />} />
                    <Route path="/admin" element={<AdminRoute><AdminDashboard /></AdminRoute>} />
                    <Route path="/admin/bookings" element={<AdminRoute><AdminVoyageBookings /></AdminRoute>} />
                    <Route path="/admin/candidates" element={<Navigate to="/admin/bookings" replace />} />
                    <Route path="/admin/media" element={<AdminRoute><AdminMedia /></AdminRoute>} />
                    <Route path="/admin/mail" element={<AdminRoute><AdminMail /></AdminRoute>} />
                    <Route path="/admin/logbook-points" element={<AdminRoute><AdminLogbookPoints /></AdminRoute>} />
                    <Route path="/admin/pack-gallery" element={<AdminRoute><AdminPackGallery /></AdminRoute>} />
                    <Route path="/admin/trackers" element={<AdminRoute><AdminMapPresence /></AdminRoute>} />
                    <Route path="/admin/spritz" element={<AdminRoute><AdminSpritzDiscoveries /></AdminRoute>} />
                    <Route path="/admin/article/:id" element={<AdminRoute><ArticleEditor /></AdminRoute>} />
                    <Route path="/admin/profile" element={<Navigate to="/profile" replace />} />
                    <Route
                      path="/profile"
                      element={
                        <RequireMainHostForAuth>
                          <AdminProfile />
                        </RequireMainHostForAuth>
                      }
                    />
                  </Routes>
                </Suspense>
              </Layout>
            </AppErrorBoundary>
          </AuthProvider>
        </I18nProvider>
      </BrowserRouter>
    </>
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
