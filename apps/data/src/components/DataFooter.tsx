import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";

const navLinks = [
  { to: "/", label: "Map" },
  { to: "/methodology", label: "Methodology" },
  { to: "/sensors", label: "Sensors" },
  { to: "/downloads", label: "Downloads" },
  { to: "/collaborate", label: "Collaborate" },
];

const DataFooter = () => (
  <footer className="px-4 pb-4 pt-8 md:px-6 md:pb-6 md:pt-10">
    <div className="glass-panel max-w-7xl mx-auto rounded-2xl px-6 py-10 md:px-10 md:py-12">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-10">
        <div className="max-w-sm">
          <div className="flex items-baseline gap-2 mb-4">
            <span className="font-serif text-xl font-bold tracking-wider text-foreground">BITE</span>
            <span className="text-[10px] font-sans font-medium uppercase tracking-[0.2em] text-muted-foreground">Data</span>
          </div>
          <p className="text-sm font-sans text-muted-foreground leading-relaxed">
            A public citizen science data portal. Environmental and navigation data collected aboard Spritz during real sailing routes, published openly for research and education.
          </p>
          <a
            href="https://biteproject.it"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 mt-4 text-xs font-sans font-medium text-teal hover:text-teal-muted transition-colors"
          >
            Visit BITE Project
            <ExternalLink size={12} />
          </a>
        </div>

        <div className="flex flex-col gap-6 md:items-end">
          <nav className="flex flex-wrap gap-2 md:justify-end">
            {navLinks.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className="glass-chip px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>

      <div className="mt-10 pt-6 border-t glass-divider flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-muted-foreground/70">
          <p>© {new Date().getFullYear()} BITE Data Portal. Part of the BITE Project.</p>
          <span>data.biteproject.it</span>
        </div>
        <p className="text-[11px] text-muted-foreground/70">
          Made by{" "}
          <a
            href="https://www.pynkstudio.it"
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground hover:text-accent transition-colors font-medium"
          >
            PynkStudio
          </a>
        </p>
      </div>
    </div>
  </footer>
);

export default DataFooter;
