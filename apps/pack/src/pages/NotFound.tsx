import { useLocation } from "react-router-dom";
import { useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="site-shell flex min-h-screen flex-col items-center justify-center bg-background px-6 py-24">
      <div className="site-shell__ambient" aria-hidden>
        <span className="site-shell__orb site-shell__orb--one" />
        <span className="site-shell__orb site-shell__orb--two" />
      </div>
      <div className="glass-panel relative z-10 max-w-lg rounded-[32px] px-10 py-12 text-center">
        <span className="glass-chip-bronze mb-6 inline-flex items-center gap-2 px-4 py-2 text-[10px] font-sans font-semibold uppercase tracking-[0.28em] text-cream">
          404
        </span>
        <h1 className="font-serif text-4xl text-cream md:text-5xl">This page drifted off course.</h1>
        <p className="mt-4 font-sans text-sm leading-relaxed text-muted-foreground">
          The URL you tried does not exist on this pack site. Head back to the main file.
        </p>
        <Link
          to="/"
          className="glass-button mt-8 inline-flex items-center justify-center gap-2 px-8 py-3"
        >
          <ArrowLeft size={16} />
          Return home
        </Link>
      </div>
    </div>
  );
};

export default NotFound;
