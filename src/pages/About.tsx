import { useI18n } from "@/lib/i18n";
import { Heart, Music } from "lucide-react";
import dinghyCrew from "@/assets/dinghy-crew.webp";
import boatSunset from "@/assets/boat-sunset.webp";
import sailingCockpit from "@/assets/sailing-cockpit.webp";
import boatHarbor from "@/assets/boat-harbor.webp";
import godot from "@/assets/godot.webp";
import snowDaisyAntlers from "@/assets/snow-daisy-antlers.webp";
import snowDaisyGarden from "@/assets/snow-daisy-garden.webp";
import duodji from "@/assets/duodji.webp";
import freyjaVedetta from "@/assets/freyja-vedetta.webp";

const calculateAge = (birthDate: string) => {
  const today = new Date();
  const [year, month, day] = birthDate.split("-").map(Number);
  let age = today.getFullYear() - year;
  const hasHadBirthdayThisYear =
    today.getMonth() + 1 > month || (today.getMonth() + 1 === month && today.getDate() >= day);

  if (!hasHadBirthdayThisYear) {
    age -= 1;
  }

  return age;
};

const TheCrew = () => {
  const { t, lang } = useI18n();
  const massimoAge = calculateAge("1996-10-16");
  const samiAge = calculateAge("1999-05-25");

  return (
    <div className="space-y-5 pb-4 md:space-y-6 md:pb-6">
      <section className="relative min-h-[78vh] overflow-hidden px-4 pb-6 pt-24 md:px-6 md:pb-8 md:pt-28">
        <div className="absolute inset-0">
          <img
            src={dinghyCrew}
            alt="The crew arriving by dinghy beside the boat"
            className="img-cover"
            loading="eager"
            fetchPriority="high"
            decoding="async"
          />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.18),transparent_34%),linear-gradient(180deg,rgba(17,28,43,0.18)_0%,rgba(17,28,43,0.46)_42%,rgba(17,28,43,0.76)_100%)]" />
        </div>
        <div className="relative z-10 mx-auto flex min-h-[calc(78vh-7rem)] max-w-6xl items-end">
          <div className="max-w-4xl px-1 md:px-0">
            <p className="mb-5 text-[11px] font-sans uppercase tracking-[0.32em] text-white/72 [text-shadow:0_6px_22px_rgba(0,0,0,0.28)]">
              {lang === "it" ? "Un po' di noi" : "A little about us"}
            </p>
            <h1 className="editorial-heading text-4xl md:text-6xl lg:text-7xl text-white mb-4 [text-shadow:0_10px_34px_rgba(0,0,0,0.30)]">
              {t("crew.title")}
            </h1>
            <p className="editorial-body text-lg md:text-xl text-white leading-relaxed max-w-2xl [text-shadow:0_8px_28px_rgba(0,0,0,0.28)]">
              {t("crew.intro")}
            </p>
          </div>
        </div>
      </section>

      <section className="page-section pt-0">
        <div className="page-section-wide glass-panel rounded-[38px] px-6 py-10 md:px-10 md:py-12">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-14 items-center">
            <div>
              <h2 className="editorial-heading text-3xl md:text-5xl mb-8">{t("crew.project.title")}</h2>
              <p className="editorial-body text-muted-foreground text-lg leading-relaxed">
                {t("crew.project.text")}
              </p>
            </div>
            <div className="glass-frame rounded-[30px] p-2 aspect-[4/3]">
              <div className="overflow-hidden rounded-[24px] h-full">
                <img
                  src={duodji}
                  alt="Duodji, the camper that came before life aboard"
                  className="img-cover hover:scale-105 transition-transform duration-700 object-bottom"
                  loading="lazy"
                  decoding="async"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="page-section pt-0">
        <div className="page-section-narrow glass-panel-light rounded-[38px] px-6 py-10 text-center md:px-10 md:py-12">
          <div className="glass-chip-light inline-flex h-14 w-14 items-center justify-center mb-6 text-slate-700">
            <Music size={20} />
          </div>
          <h2 className="editorial-heading text-3xl md:text-5xl mb-8 text-slate-950">{t("crew.name.title")}</h2>
          <p className="editorial-body text-muted-foreground text-lg leading-relaxed max-w-2xl mx-auto mb-12">
            {t("crew.name.text")}
          </p>
          <blockquote className="glass-chip-light max-w-lg mx-auto mb-8 px-6 py-6 font-serif italic text-xl md:text-2xl text-slate-900 leading-relaxed">
            "Like a love that started out as friends<br />
            We couldn't comprehend<br />
            How better is the end"
          </blockquote>
          <p className="text-xs font-sans tracking-[0.2em] uppercase text-slate-500 mb-8">
            — Tophouse, "Better Is The End"
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <a
              href="https://open.spotify.com/intl-it/track/0CdiZMYPqjof8EhRWYg9hr"
              target="_blank"
              rel="noopener noreferrer"
              className="glass-button-secondary inline-flex items-center gap-2 px-5 py-2.5 text-xs font-sans tracking-wide"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>
              Spotify
            </a>
            <a
              href="https://music.apple.com/it/album/better-is-the-end/1841469790?i=1841469791"
              target="_blank"
              rel="noopener noreferrer"
              className="glass-button-secondary inline-flex items-center gap-2 px-5 py-2.5 text-xs font-sans tracking-wide"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M23.994 6.124a9.23 9.23 0 00-.24-2.19c-.317-1.31-1.062-2.31-2.18-3.043A5.022 5.022 0 0019.7.237a10.16 10.16 0 00-1.898-.116C17.023.074 16.244.05 15.464.05H8.54c-.78 0-1.56.024-2.338.07a10.19 10.19 0 00-1.898.116 5.022 5.022 0 00-1.874.654C1.312 1.603.567 2.603.25 3.913a9.23 9.23 0 00-.24 2.19c-.046.78-.07 1.56-.07 2.338v7.098c0 .78.024 1.56.07 2.338.024.74.096 1.47.24 2.19.317 1.31 1.062 2.31 2.18 3.043a5.022 5.022 0 001.874.654c.634.092 1.27.116 1.898.116.78.046 1.56.07 2.338.07h6.924c.78 0 1.56-.024 2.338-.07a10.19 10.19 0 001.898-.116 5.022 5.022 0 001.874-.654c1.118-.733 1.863-1.733 2.18-3.043.144-.72.216-1.45.24-2.19.046-.78.07-1.56.07-2.338V8.462c0-.78-.024-1.56-.07-2.338zM11.56 17.97l-.005.005c-.038.038-.088.07-.144.096a.462.462 0 01-.382.003.352.352 0 01-.114-.07l-.005-.004a.97.97 0 01-.18-.264 1.857 1.857 0 01-.126-.39 3.946 3.946 0 01-.064-.484 8.654 8.654 0 01-.015-.534v-5.26c0-.156.002-.314.007-.468a4.357 4.357 0 01.04-.44c.023-.15.056-.296.1-.436a1.94 1.94 0 01.18-.394c.156-.264.372-.462.648-.594.276-.132.57-.2.882-.2.156 0 .306.018.45.054a1.7 1.7 0 01.414.162c.132.072.252.162.36.27.108.108.198.234.27.378l.005.005c.072.144.126.3.162.468.036.168.054.342.054.522 0 .18-.018.354-.054.522a1.862 1.862 0 01-.162.468l-.005.005a1.748 1.748 0 01-.63.648 1.7 1.7 0 01-.414.162 1.584 1.584 0 01-.45.054c-.234 0-.444-.042-.63-.126a1.415 1.415 0 01-.474-.342v3.834c0 .18-.006.354-.018.522a3.782 3.782 0 01-.066.486 2.206 2.206 0 01-.132.414.996.996 0 01-.224.328z"/></svg>
              Apple Music
            </a>
          </div>
        </div>
      </section>

      <section className="page-section pt-0">
        <div className="page-section-wide glass-panel rounded-[38px] px-6 py-10 md:px-10 md:py-12">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="glass-panel-soft rounded-[28px] p-6 md:p-8">
              <h3 className="editorial-heading text-2xl md:text-4xl mb-6">{t("crew.massimo.title")}</h3>
              <p className="editorial-body text-muted-foreground leading-relaxed">
                {t("crew.massimo.text", { age: massimoAge })}
              </p>
            </div>
            <div className="glass-panel-soft rounded-[28px] p-6 md:p-8">
              <h3 className="editorial-heading text-2xl md:text-4xl mb-6">{t("crew.sami.title")}</h3>
              <p className="editorial-body text-muted-foreground leading-relaxed">
                {t("crew.sami.text", { age: samiAge })}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="page-section pt-0">
        <div className="page-section-wide glass-panel rounded-[38px] px-6 py-10 md:px-10 md:py-12">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-14 items-center">
            <div className="glass-frame rounded-[30px] p-2 aspect-[4/3]">
              <div className="overflow-hidden rounded-[24px] h-full">
                <img
                  src={godot}
                  alt="Godot aboard"
                  className="img-cover object-[50%_30%] hover:scale-105 transition-transform duration-700"
                  loading="lazy"
                  decoding="async"
                />
              </div>
            </div>
            <div>
              <h3 className="editorial-heading text-2xl md:text-4xl mb-6">{t("crew.godot.title")}</h3>
              <p className="editorial-body text-muted-foreground leading-relaxed">
                {t("crew.godot.text")}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="page-section pt-0">
        <div className="page-section-wide glass-panel rounded-[38px] px-6 py-10 md:px-10 md:py-12">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-14 items-center">
            <div className="order-2 lg:order-1">
              <h3 className="editorial-heading text-2xl md:text-4xl mb-6">{t("crew.freyja.title")}</h3>
              <p className="editorial-body text-muted-foreground leading-relaxed">
                {t("crew.freyja.text")}
              </p>
            </div>
            <div className="glass-frame rounded-[30px] p-2 aspect-[4/3] order-1 lg:order-2">
              <div className="overflow-hidden rounded-[24px] h-full">
                <img
                  src={freyjaVedetta}
                  alt="Freyja, Alaskan Malamute, on watch aboard Spritz"
                  className="img-cover object-[35%_25%] hover:scale-105 transition-transform duration-700"
                  loading="lazy"
                  decoding="async"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="page-section pt-0">
        <div className="page-section-wide glass-panel-light rounded-[38px] px-6 py-10 md:px-10 md:py-12">
          <div className="page-section-narrow text-center mb-10">
            <div className="glass-chip-light inline-flex h-14 w-14 items-center justify-center mb-6 text-slate-700">
              <Heart size={24} />
            </div>
            <p className="text-xs font-sans tracking-[0.3em] uppercase text-slate-500 mb-4">
              {t("crew.snow.subtitle")}
            </p>
            <h3 className="editorial-heading text-3xl md:text-5xl mb-8 text-slate-950">{t("crew.snow.title")}</h3>
            <p className="editorial-body text-muted-foreground text-lg leading-relaxed max-w-2xl mx-auto">
              {t("crew.snow.text")}
            </p>
          </div>
          <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
            <div className="glass-frame mx-auto w-full rounded-[30px] p-2">
              <div className="flex aspect-[3/4] h-full items-center justify-center overflow-hidden rounded-[24px] bg-white/45 md:aspect-[4/3]">
                <img
                  src={snowDaisyGarden}
                  alt="Snow Daisy smiling behind garden plants"
                  className="h-full w-full object-contain object-center"
                  loading="lazy"
                  decoding="async"
                />
              </div>
            </div>
            <div className="glass-frame mx-auto w-full rounded-[30px] p-2">
              <div className="flex aspect-[3/4] h-full items-center justify-center overflow-hidden rounded-[24px] bg-white/45 md:aspect-[4/3]">
                <img
                  src={snowDaisyAntlers}
                  alt="Snow Daisy wearing antlers"
                  className="h-full w-full object-contain object-center"
                  loading="lazy"
                  decoding="async"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="page-section pt-0">
        <div className="page-section-wide glass-panel rounded-[38px] px-6 py-10 md:px-10 md:py-12">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-14 items-center">
            <div>
              <h2 className="editorial-heading text-3xl md:text-5xl mb-8">{t("crew.spritz.title")}</h2>
              <p className="editorial-body text-muted-foreground text-lg leading-relaxed">
                {t("crew.spritz.text")}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="glass-frame rounded-[28px] p-2 aspect-[3/4]">
                <div className="overflow-hidden rounded-[22px] h-full">
                  <img
                    src={boatHarbor}
                    alt="Spritz in harbor"
                    className="img-cover hover:scale-105 transition-transform duration-700"
                    loading="lazy"
                    decoding="async"
                  />
                </div>
              </div>
              <div className="glass-frame rounded-[28px] p-2 aspect-[3/4] mt-8">
                <div className="overflow-hidden rounded-[22px] h-full">
                  <img
                    src={sailingCockpit}
                    alt="Cockpit while sailing"
                    className="img-cover hover:scale-105 transition-transform duration-700"
                    loading="lazy"
                    decoding="async"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="page-section pt-0">
        <div className="page-section-wide">
          <div className="glass-frame rounded-[34px] p-2 overflow-hidden">
            <div className="overflow-hidden rounded-[28px] aspect-[16/7] md:aspect-[16/6] max-h-[420px]">
              <img src={boatSunset} alt="Spritz at sunset" className="img-cover object-bottom" loading="lazy" decoding="async" />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default TheCrew;
