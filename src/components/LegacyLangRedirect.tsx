import { Navigate, useLocation } from "react-router-dom";
import { detectPreferredLang, withLang } from "@/lib/seo";

/**
 * Redirects any legacy non-prefixed URL to its localized version, picking
 * the language from the user's persisted preference (localStorage/cookie)
 * or the browser. Path is preserved.
 *
 * Use as: <Route path="/logbook" element={<LegacyLangRedirect to="/logbook" />} />
 */
export function LegacyLangRedirect({ to }: { to: string }) {
  const location = useLocation();
  const lang = detectPreferredLang();
  return <Navigate to={withLang(lang, to) + location.search + location.hash} replace />;
}

/**
 * Same as LegacyLangRedirect but preserves dynamic params present in the
 * matched route. Pass the resolved path (with params already substituted).
 */
export function LegacyLangRedirectFromPath() {
  const location = useLocation();
  const lang = detectPreferredLang();
  return (
    <Navigate
      to={withLang(lang, location.pathname) + location.search + location.hash}
      replace
    />
  );
}

export default LegacyLangRedirect;

/** Legacy redirect that preserves a single dynamic param. */
import { useParams } from "react-router-dom";

export function LegacyVoyageRedirect() {
  const { voyageRef } = useParams();
  const location = useLocation();
  const lang = detectPreferredLang();
  return (
    <Navigate
      to={withLang(lang, `/voyages/${voyageRef ?? ""}`) + location.search + location.hash}
      replace
    />
  );
}

export function LegacyArticleRedirect() {
  const { slug } = useParams();
  const location = useLocation();
  const lang = detectPreferredLang();
  return (
    <Navigate
      to={withLang(lang, `/logbook/${slug ?? ""}`) + location.search + location.hash}
      replace
    />
  );
}

export function LegacyStoryRedirect() {
  const { slug } = useParams();
  const location = useLocation();
  const lang = detectPreferredLang();
  return (
    <Navigate
      to={withLang(lang, `/logbook/story/${slug ?? ""}`) + location.search + location.hash}
      replace
    />
  );
}