import { Instagram, Mail } from "lucide-react";
import { instagramProfile, isItalian, navLinks } from "@/data/site";

const MessageIcon = ({ size = 16, className }: { size?: number; className?: string }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden
  >
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  </svg>
);

export const Footer = () => (
  <footer className="px-4 pb-6 pt-4 md:px-6 md:pb-8">
    <div className="container-editorial">
      <div className="glass-panel mx-auto max-w-7xl rounded-[34px] px-6 py-10 md:px-10 md:py-12">
        <div className="flex flex-col gap-10 md:flex-row md:items-start md:justify-between">
          <div className="max-w-md">
            <span className="glass-chip-bronze mb-5 inline-flex items-center gap-2 px-4 py-2 text-[10px] font-sans font-semibold uppercase tracking-[0.28em] text-cream">
              <span className="h-2 w-2 rounded-full bg-charcoal/75" />
              BITE · PACK
            </span>
            <h3 className="mb-3 font-serif text-2xl font-semibold tracking-[0.12em] text-cream md:text-3xl">
              Godot &amp; Freyja
            </h3>
            <p className="font-serif text-lg italic leading-relaxed text-cream/75 md:text-xl">
              {isItalian
                ? "Un pack operativo di BITE: due cani, un handler, documenti sempre aggiornati."
                : "A working pack from BITE — two dogs, one handler, paperwork that stays current."}
            </p>
          </div>

          <div className="flex flex-col gap-8 md:items-end">
            <nav className="flex flex-wrap gap-2 md:justify-end">
              {navLinks.map((l) => (
                <a
                  key={l.id}
                  href={`#${l.id}`}
                  className="glass-chip rounded-full px-4 py-2 font-sans text-xs text-muted-foreground transition-colors hover:text-cream"
                >
                  {l.label}
                </a>
              ))}
            </nav>
            <div className="flex flex-wrap items-center gap-3 md:justify-end">
              <a
                href={instagramProfile.url}
                target="_blank"
                rel="noopener noreferrer"
                className="glass-chip inline-flex h-10 w-10 items-center justify-center text-muted-foreground transition-colors hover:text-cream"
                aria-label="Instagram"
              >
                <Instagram size={16} />
              </a>
              <a
                href="mailto:hello@biteproject.it"
                className="glass-chip inline-flex h-10 w-10 items-center justify-center text-muted-foreground transition-colors hover:text-cream"
                aria-label="Email"
              >
                <Mail size={16} />
              </a>
              <a
                href="https://wa.me/00000000000"
                target="_blank"
                rel="noopener noreferrer"
                className="glass-chip inline-flex h-10 w-10 items-center justify-center text-muted-foreground transition-colors hover:text-cream"
                aria-label="WhatsApp"
              >
                <MessageIcon size={16} />
              </a>
            </div>
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-4 border-t border-cream/10 pt-6 md:flex-row md:items-center md:justify-between">
          <p className="font-sans text-[11px] text-muted-foreground">
            © {new Date().getFullYear()} BITE&apos;s PACK. All rights reserved.
          </p>
          <p className="font-sans text-[11px] text-muted-foreground">
            pack.biteproject.it ·{" "}
            <a href="https://biteproject.it" className="text-cream/80 underline-offset-4 hover:text-bronze hover:underline">
              biteproject.it
            </a>
          </p>
        </div>
      </div>
    </div>
  </footer>
);
