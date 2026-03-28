import { useI18n } from "@/lib/i18n";

const Contact = () => {
  const { t } = useI18n();

  return (
    <div className="space-y-5 pb-4 md:space-y-6 md:pb-6">
      <section className="pt-28 pb-0 md:pt-32 px-6 md:px-12">
        <div className="page-section-narrow glass-panel rounded-[38px] px-6 py-10 md:px-10 md:py-12">
          <p className="glass-chip inline-flex px-4 py-2 text-[11px] font-sans uppercase tracking-[0.28em] text-accent mb-6">
            {t("nav.contact")}
          </p>
          <h1 className="editorial-heading text-4xl md:text-6xl lg:text-7xl mb-4">
            {t("contact.title")}
          </h1>
          <p className="editorial-body text-lg text-muted-foreground max-w-2xl">
            {t("contact.subtitle")}
          </p>
        </div>
      </section>

      <section className="px-6 md:px-12 pb-0">
        <div className="page-section-wide">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8">
            <form onSubmit={(e) => e.preventDefault()} className="glass-panel rounded-[34px] p-6 md:p-8 space-y-6">
              <div>
                <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-2 block">
                  {t("contact.name")}
                </label>
                <div className="glass-input rounded-[22px] px-1.5">
                  <input
                    type="text"
                    className="w-full bg-transparent px-4 py-3 text-foreground font-sans focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-2 block">
                  {t("contact.email")}
                </label>
                <div className="glass-input rounded-[22px] px-1.5">
                  <input
                    type="email"
                    className="w-full bg-transparent px-4 py-3 text-foreground font-sans focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-2 block">
                  {t("contact.subject")}
                </label>
                <div className="glass-input rounded-[22px] px-1.5">
                  <input
                    type="text"
                    className="w-full bg-transparent px-4 py-3 text-foreground font-sans focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-2 block">
                  {t("contact.message")}
                </label>
                <div className="glass-input rounded-[26px] px-1.5 py-1.5">
                  <textarea
                    rows={5}
                    className="w-full bg-transparent px-4 py-3 text-foreground font-sans focus:outline-none resize-none"
                  />
                </div>
              </div>
              <button
                type="submit"
                className="glass-button px-8 py-3.5 text-sm font-sans font-medium tracking-wide mt-4"
              >
                {t("contact.send")}
              </button>
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
                <div className="flex flex-col gap-2">
                  <a href="https://www.instagram.com/better_is_the_end" target="_blank" rel="noopener noreferrer" className="text-foreground hover:text-accent transition-colors font-sans">Instagram</a>
                  <a href="https://www.youtube.com/@better_is_the_end" target="_blank" rel="noopener noreferrer" className="text-foreground hover:text-accent transition-colors font-sans">YouTube</a>
                  <a href="https://www.tiktok.com/@better_is_the_end" target="_blank" rel="noopener noreferrer" className="text-foreground hover:text-accent transition-colors font-sans">TikTok</a>
                  <a href="https://dashboard.seapeopleapp.com/group/41a0ad62-7f71-4107-9269-878fa210f24c?utm_source=SP&utm_medium=usershare&utm_campaign=mpernozzoli" target="_blank" rel="noopener noreferrer" className="text-foreground hover:text-accent transition-colors font-sans">SeaPeople Community</a>
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
    </div>
  );
};

export default Contact;
