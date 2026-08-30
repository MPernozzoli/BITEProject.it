import { type ChangeEvent, type FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Instagram, Ship, Youtube } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { usePublicContentSnapshot } from "@/hooks/usePublicContentSnapshot";
import { withLang } from "@/lib/seo";
import {
  buildVoyagePath,
  formatVoyageDateRange,
  getLocalizedVoyageName,
  type Voyage,
} from "@/lib/voyage-utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const TikTokIcon = ({ size = 18, className }: { size?: number; className?: string }) => (
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
    aria-hidden="true"
  >
    <path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5" />
  </svg>
);

const SeaPeopleIcon = ({ size = 18, className }: { size?: number; className?: string }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="M12 3v18" />
    <path d="M7 4v4.5c0 3 1.8 5.2 5 6.8" />
    <path d="M17 4v4.5c0 3-1.8 5.2-5 6.8" />
    <path d="M7 4 4.5 7" />
    <path d="M17 4 19.5 7" />
  </svg>
);

type ContactFormValues = {
  name: string;
  email: string;
  subject: string;
  message: string;
  company: string;
};

type ContactFormErrors = Partial<Record<keyof Omit<ContactFormValues, "company">, string>>;

const EMPTY_FORM: ContactFormValues = {
  name: "",
  email: "",
  subject: "",
  message: "",
  company: "",
};

const Contact = () => {
  const { t, lang } = useI18n();
  const { toast } = useToast();
  const [voyagesDialogOpen, setVoyagesDialogOpen] = useState(false);
  const [formValues, setFormValues] = useState<ContactFormValues>(EMPTY_FORM);
  const [errors, setErrors] = useState<ContactFormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitState, setSubmitState] = useState<"idle" | "success" | "error">("idle");

  useEffect(() => {
    let cancelled = false;

    const preloadContactFields = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user || cancelled) {
        return;
      }

      let profileName: string | null = null;

      const { data: profile } = await supabase
        .from("profiles")
        .select("name")
        .eq("id", session.user.id)
        .maybeSingle();

      if (typeof profile?.name === "string" && profile.name.trim()) {
        profileName = profile.name.trim();
      }

      const fallbackName =
        typeof session.user.user_metadata?.name === "string" && session.user.user_metadata.name.trim()
          ? session.user.user_metadata.name.trim()
          : typeof session.user.user_metadata?.full_name === "string" && session.user.user_metadata.full_name.trim()
            ? session.user.user_metadata.full_name.trim()
            : "";

      const nextName = profileName || fallbackName;
      const nextEmail = session.user.email?.trim() || "";

      if (cancelled || (!nextName && !nextEmail)) {
        return;
      }

      setFormValues((current) => ({
        ...current,
        name: current.name.trim() ? current.name : nextName,
        email: current.email.trim() ? current.email : nextEmail,
      }));
    };

    void preloadContactFields();

    return () => {
      cancelled = true;
    };
  }, []);

  const { data: publicContent, isLoading: isPublicContentLoading } = usePublicContentSnapshot();
  const { data: liveVoyages = [] } = useQuery<Voyage[]>({
    queryKey: ["public-voyages"],
    enabled: !publicContent && !isPublicContentLoading,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("voyages")
        .select("*")
        .eq("is_published", true)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data || []) as Voyage[];
    },
  });

  /**
   * Voyages you can actually apply for. There is normally at most one, so the
   * notice links straight to it; when there are several it opens the dialog.
   */
  const bookableVoyages = useMemo(() => {
    const source = publicContent?.voyages ?? liveVoyages;
    return source.filter((voyage) => voyage.booking_enabled && voyage.status !== "completed");
  }, [liveVoyages, publicContent]);

  const voyagePath = (voyage: Voyage) => withLang(lang, `${buildVoyagePath(voyage, lang)}#partecipa`);

  const fieldLabels = useMemo(
    () => ({
      name: t("contact.name"),
      email: t("contact.email"),
      subject: t("contact.subject"),
      message: t("contact.message"),
    }),
    [t],
  );

  const validate = (values: ContactFormValues): ContactFormErrors => {
    const nextErrors: ContactFormErrors = {};

    if (!values.name.trim()) {
      nextErrors.name = t("contact.validation.name");
    }

    const normalizedEmail = values.email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      nextErrors.email = t("contact.validation.email");
    }

    if (!values.subject.trim()) {
      nextErrors.subject = t("contact.validation.subject");
    }

    if (values.message.trim().length < 10) {
      nextErrors.message = t("contact.validation.message");
    }

    return nextErrors;
  };

  const handleChange =
    (field: keyof ContactFormValues) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const nextValue = event.target.value;
      setFormValues((current) => ({ ...current, [field]: nextValue }));
      setSubmitState("idle");

      if (field === "company") {
        return;
      }

      setErrors((current) => {
        if (!current[field]) return current;
        const nextErrors = { ...current };
        delete nextErrors[field];
        return nextErrors;
      });
    };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const nextErrors = validate(formValues);
    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      setSubmitState("idle");
      return;
    }

    setIsSubmitting(true);
    setSubmitState("idle");

    try {
      const { error } = await supabase.functions.invoke("contact-form-submit", {
        body: {
          ...formValues,
          language: lang,
        },
      });

      if (error) {
        throw error;
      }

      setFormValues(EMPTY_FORM);
      setErrors({});
      setSubmitState("success");
      toast({
        title: t("contact.status.success"),
      });
    } catch (error) {
      console.error("Failed to submit contact form", error);
      setSubmitState("error");
      toast({
        title: t("contact.status.error"),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderError = (field: keyof ContactFormErrors) =>
    errors[field] ? <p className="mt-2 text-sm text-destructive">{errors[field]}</p> : null;

  return (
    <div className="space-y-5 pb-4 md:space-y-6 md:pb-6">
      <section className="pt-28 pb-0 md:pt-32 px-6 md:px-12">
        <div className="page-section-narrow">
          <p className="mb-5 text-[11px] font-sans uppercase tracking-[0.32em] text-accent/80">
            {lang === "it" ? "Messaggi, idee, collaborazioni" : "Messages, ideas, collaborations"}
          </p>
          <h1 className="editorial-heading text-4xl md:text-6xl lg:text-7xl mb-4">
            {t("contact.title")}
          </h1>
          <p className="editorial-body text-lg text-muted-foreground max-w-2xl">
            {t("contact.subtitle")}
          </p>
        </div>
      </section>

      <section className="px-6 md:px-12 pt-2">
        <div className="page-section-narrow">
          <div className="glass-panel rounded-[34px] border-emerald-200/60 bg-gradient-to-br from-emerald-50/80 to-white/55 p-6 md:p-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                <Ship size={20} />
              </span>
              <div className="min-w-0 space-y-3">
                <p className="text-[11px] font-sans uppercase tracking-[0.28em] text-emerald-800/80">
                  {t("contact.voyages.eyebrow")}
                </p>
                <h2 className="editorial-heading text-2xl md:text-3xl text-emerald-950">
                  {t("contact.voyages.title")}
                </h2>
                <p className="editorial-body text-emerald-900/80 max-w-xl">{t("contact.voyages.body")}</p>

                {bookableVoyages.length === 1 ? (
                  <div className="space-y-1.5">
                    <Link
                      to={voyagePath(bookableVoyages[0])}
                      className="glass-button inline-flex items-center gap-2 px-6 py-3 text-sm font-sans font-medium"
                    >
                      {t("contact.voyages.ctaSingle", { voyage: getLocalizedVoyageName(bookableVoyages[0], lang) })}
                      <ArrowRight size={16} />
                    </Link>
                    {formatVoyageDateRange(bookableVoyages[0], lang === "it" ? "it-IT" : "en-US") ? (
                      <p className="text-xs font-sans text-emerald-900/70">
                        {formatVoyageDateRange(bookableVoyages[0], lang === "it" ? "it-IT" : "en-US")}
                      </p>
                    ) : null}
                  </div>
                ) : bookableVoyages.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => setVoyagesDialogOpen(true)}
                    className="glass-button inline-flex items-center gap-2 px-6 py-3 text-sm font-sans font-medium"
                  >
                    {t("contact.voyages.ctaMany")}
                    <ArrowRight size={16} />
                  </button>
                ) : (
                  <div className="space-y-2">
                    <p className="text-sm font-sans text-emerald-900/75">{t("contact.voyages.none")}</p>
                    <Link
                      to={withLang(lang, "/voyages")}
                      className="glass-button inline-flex items-center gap-2 px-6 py-3 text-sm font-sans font-medium"
                    >
                      {t("contact.voyages.ctaNone")}
                      <ArrowRight size={16} />
                    </Link>
                  </div>
                )}

                <p className="pt-1 text-sm font-sans text-emerald-900/70">{t("contact.form.note")}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="px-6 md:px-12 pb-0">
        <div className="page-section-wide">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8">
            <form onSubmit={handleSubmit} className="glass-panel rounded-[34px] p-6 md:p-8 space-y-6">
              <div className="hidden" aria-hidden="true">
                <label htmlFor="contact-company">Company</label>
                <input
                  id="contact-company"
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  value={formValues.company}
                  onChange={handleChange("company")}
                />
              </div>
              <div>
                <label
                  htmlFor="contact-name"
                  className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-2 block"
                >
                  {fieldLabels.name}
                </label>
                <div className="glass-input rounded-[22px] px-1.5">
                  <input
                    id="contact-name"
                    type="text"
                    autoComplete="name"
                    value={formValues.name}
                    onChange={handleChange("name")}
                    placeholder={t("contact.namePlaceholder")}
                    className="w-full bg-transparent px-4 py-3 text-foreground font-sans focus:outline-none"
                  />
                </div>
                {renderError("name")}
              </div>
              <div>
                <label
                  htmlFor="contact-email"
                  className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-2 block"
                >
                  {fieldLabels.email}
                </label>
                <div className="glass-input rounded-[22px] px-1.5">
                  <input
                    id="contact-email"
                    type="email"
                    autoComplete="email"
                    value={formValues.email}
                    onChange={handleChange("email")}
                    placeholder={t("contact.emailPlaceholder")}
                    className="w-full bg-transparent px-4 py-3 text-foreground font-sans focus:outline-none"
                  />
                </div>
                {renderError("email")}
              </div>
              <div>
                <label
                  htmlFor="contact-subject"
                  className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-2 block"
                >
                  {fieldLabels.subject}
                </label>
                <div className="glass-input rounded-[22px] px-1.5">
                  <input
                    id="contact-subject"
                    type="text"
                    value={formValues.subject}
                    onChange={handleChange("subject")}
                    placeholder={t("contact.subjectPlaceholder")}
                    className="w-full bg-transparent px-4 py-3 text-foreground font-sans focus:outline-none"
                  />
                </div>
                {renderError("subject")}
              </div>
              <div>
                <label
                  htmlFor="contact-message"
                  className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-2 block"
                >
                  {fieldLabels.message}
                </label>
                <div className="glass-input rounded-[26px] px-1.5 py-1.5">
                  <textarea
                    id="contact-message"
                    rows={5}
                    value={formValues.message}
                    onChange={handleChange("message")}
                    placeholder={t("contact.messagePlaceholder")}
                    className="w-full bg-transparent px-4 py-3 text-foreground font-sans focus:outline-none resize-none"
                  />
                </div>
                {renderError("message")}
              </div>
              <div className="space-y-3">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="glass-button px-8 py-3.5 text-sm font-sans font-medium tracking-wide shadow-[0_16px_36px_rgba(32,55,88,0.2)] saturate-[1.35] brightness-110 hover:saturate-[1.5] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70 disabled:saturate-100 disabled:brightness-100"
                >
                  {isSubmitting ? t("contact.sending") : t("contact.send")}
                </button>
                {submitState === "success" ? (
                  <p className="text-sm text-accent">{t("contact.status.success")}</p>
                ) : null}
                {submitState === "error" ? (
                  <p className="text-sm text-destructive">{t("contact.status.error")}</p>
                ) : null}
              </div>
            </form>

            <div className="glass-panel rounded-[34px] p-6 md:p-8 space-y-8">
              <div className="glass-panel-soft rounded-[26px] p-5">
                <p className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-3">Email</p>
                <a href="mailto:hello@biteproject.com" className="editorial-heading text-xl hover:text-accent transition-colors">
                  hello@biteproject.com
                </a>
              </div>
              <div className="glass-panel-soft rounded-[26px] p-5">
                <p className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-3">Social</p>
                <div className="flex flex-wrap items-center gap-3">
                  {[
                    {
                      href: "https://www.instagram.com/biteproject.it",
                      label: "Instagram",
                      icon: Instagram,
                    },
                    {
                      href: "https://www.youtube.com/@better_is_the_end",
                      label: "YouTube",
                      icon: Youtube,
                    },
                    {
                      href: "https://www.tiktok.com/@better_is_the_end",
                      label: "TikTok",
                      icon: TikTokIcon,
                    },
                    {
                      href: "https://dashboard.seapeopleapp.com/group/41a0ad62-7f71-4107-9269-878fa210f24c?utm_source=SP&utm_medium=usershare&utm_campaign=mpernozzoli",
                      label: "SeaPeople",
                      icon: SeaPeopleIcon,
                    },
                  ].map(({ href, label, icon: Icon }) => (
                    <a
                      key={label}
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={label}
                      title={label}
                      className="glass-chip inline-flex h-11 w-11 items-center justify-center text-foreground hover:text-accent transition-colors"
                    >
                      <Icon size={18} />
                      <span className="sr-only">{label}</span>
                    </a>
                  ))}
                </div>
              </div>
              <div className="glass-panel-soft rounded-[26px] p-5">
                <p className="editorial-body text-muted-foreground leading-relaxed">
                  {t("contact.closing")}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Dialog open={voyagesDialogOpen} onOpenChange={setVoyagesDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("contact.voyages.modalTitle")}</DialogTitle>
            <DialogDescription>{t("contact.voyages.modalBody")}</DialogDescription>
          </DialogHeader>
          <ul className="max-h-[60vh] space-y-2 overflow-y-auto">
            {bookableVoyages.map((voyage) => {
              const dates = formatVoyageDateRange(voyage, lang === "it" ? "it-IT" : "en-US");
              return (
                <li key={voyage.id}>
                  <Link
                    to={voyagePath(voyage)}
                    onClick={() => setVoyagesDialogOpen(false)}
                    className="flex items-center justify-between gap-3 rounded-[22px] border border-border/70 bg-background/50 px-4 py-3 transition-colors hover:border-accent/60"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-sans text-foreground">
                        {getLocalizedVoyageName(voyage, lang)}
                      </span>
                      {dates ? (
                        <span className="mt-0.5 block text-xs font-sans text-muted-foreground">{dates}</span>
                      ) : null}
                    </span>
                    <ArrowRight size={16} className="shrink-0 text-accent" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Contact;
