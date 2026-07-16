/**
 * Local-only escape hatch that renders the admin shell without a Supabase session,
 * so the admin panels can be worked on without signing in.
 *
 * This grants no privileges. It only skips the client-side route gate; every read and
 * write still goes through RLS, which demands a real admin JWT. With the bypass on you
 * get published voyages (public SELECT) and client-side drafts, and writes fail — which
 * is the point: the panel is explorable without production data being reachable.
 *
 * Two independent locks, both of which must be open:
 *  - import.meta.env.DEV is hardcoded false by Vite in any production build, so this
 *    branch is dead code that gets stripped from the shipped bundle;
 *  - VITE_ADMIN_DEV_BYPASS must be opted into explicitly, so a dev server is not
 *    silently unguarded.
 */
export const isAdminDevBypassEnabled = (): boolean =>
  import.meta.env.DEV && import.meta.env.VITE_ADMIN_DEV_BYPASS === "true";
