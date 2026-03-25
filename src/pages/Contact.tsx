import { useI18n } from "@/lib/i18n";

const Contact = () => {
  const { t } = useI18n();

  return (
    <div>
      <section className="pt-32 pb-20 md:pt-40 md:pb-32 px-6 md:px-12">
        <div className="page-section-narrow">
          <h1 className="editorial-heading text-4xl md:text-6xl lg:text-7xl mb-4">
            {t("contact.title")}
          </h1>
          <p className="editorial-body text-lg text-muted-foreground max-w-2xl">
            {t("contact.subtitle")}
          </p>
        </div>
      </section>

      <section className="px-6 md:px-12 pb-20 md:pb-32">
        <div className="page-section-wide">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 lg:gap-24">
            {/* Form */}
            <form onSubmit={(e) => e.preventDefault()} className="space-y-6">
              <div>
                <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-2 block">
                  {t("contact.name")}
                </label>
                <input
                  type="text"
                  className="w-full bg-transparent border-b border-border py-3 text-foreground font-sans focus:outline-none focus:border-accent transition-colors"
                />
              </div>
              <div>
                <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-2 block">
                  {t("contact.email")}
                </label>
                <input
                  type="email"
                  className="w-full bg-transparent border-b border-border py-3 text-foreground font-sans focus:outline-none focus:border-accent transition-colors"
                />
              </div>
              <div>
                <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-2 block">
                  {t("contact.subject")}
                </label>
                <input
                  type="text"
                  className="w-full bg-transparent border-b border-border py-3 text-foreground font-sans focus:outline-none focus:border-accent transition-colors"
                />
              </div>
              <div>
                <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-2 block">
                  {t("contact.message")}
                </label>
                <textarea
                  rows={5}
                  className="w-full bg-transparent border-b border-border py-3 text-foreground font-sans focus:outline-none focus:border-accent transition-colors resize-none"
                />
              </div>
              <button
                type="submit"
                className="bg-primary text-primary-foreground px-8 py-3.5 text-sm font-sans font-medium tracking-wide hover:bg-navy-light transition-colors mt-4"
              >
                {t("contact.send")}
              </button>
            </form>

            {/* Info */}
            <div className="space-y-12">
              <div>
                <p className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-3">Email</p>
                <a href="mailto:hello@biteproject.com" className="editorial-heading text-xl hover:text-accent transition-colors">
                  hello@biteproject.com
                </a>
              </div>
              <div>
                <p className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-3">Social</p>
                <div className="flex flex-col gap-2">
                  <a href="https://instagram.com" target="_blank" rel="noopener noreferrer" className="text-foreground hover:text-accent transition-colors font-sans">Instagram</a>
                  <a href="https://youtube.com" target="_blank" rel="noopener noreferrer" className="text-foreground hover:text-accent transition-colors font-sans">YouTube</a>
                </div>
              </div>
              <div className="border-t border-border pt-8">
                <p className="editorial-body text-muted-foreground leading-relaxed">
                  {t("contact.closing")}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Contact;
