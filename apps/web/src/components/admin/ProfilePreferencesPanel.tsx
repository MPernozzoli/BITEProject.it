import type { Dispatch, SetStateAction } from "react";
import { Switch } from "@/components/ui/switch";
import { ALL_LANGUAGES, SITE_LANGUAGES } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { ProfileCopy } from "@/lib/profile-copy";

/**
 * Card "Preferenze" del tab omonimo di `/profile`: lingua e newsletter.
 * Passkey, push e notifiche articoli/storie sono in `ProfileSecurityPanel` e
 * `ProfileNotificationsPanel` — erano infilate qui prima del ridisegno a tab.
 */
export interface ProfilePreferencesPanelProps {
  copy: ProfileCopy;
  preferredLanguage: string;
  secondaryLanguage: string | null;
  isSiteNative: boolean;
  handleLanguageChange: (value: string) => void;
  setSecondaryLanguage: Dispatch<SetStateAction<string | null>>;
  newsletterSubscribed: boolean;
  setNewsletterSubscribed: Dispatch<SetStateAction<boolean>>;
}

const ProfilePreferencesPanel = ({
  copy,
  preferredLanguage,
  secondaryLanguage,
  isSiteNative,
  handleLanguageChange,
  setSecondaryLanguage,
  newsletterSubscribed,
  setNewsletterSubscribed,
}: ProfilePreferencesPanelProps) => {
  return (
    <div className="rounded-[34px] border border-border/85 bg-glass/60 p-6 md:p-8 shadow-[0_20px_48px_rgba(15,23,42,0.06)]">
      <p className="text-[11px] font-sans uppercase tracking-[0.28em] text-muted-foreground mb-2">
        {copy.sections.preferencesEyebrow}
      </p>
      <h2 className="editorial-heading text-2xl md:text-3xl mb-3">{copy.sections.preferencesTitle}</h2>
      <p className="text-sm font-sans text-muted-foreground leading-relaxed mb-6">
        {copy.sections.preferencesText}
      </p>

      <div className="space-y-6">
        <div className="space-y-3">
          <label className="text-xs font-sans uppercase tracking-[0.24em] text-muted-foreground">
            {copy.fields.preferredLanguage}
          </label>
          <div className="flex flex-wrap gap-2">
            {ALL_LANGUAGES.map((language) => (
              <button
                key={language.code}
                type="button"
                onClick={() => handleLanguageChange(language.code)}
                className={cn(
                  "rounded-full border px-4 py-2.5 text-sm font-sans transition-all",
                  preferredLanguage === language.code
                    ? "border-accent/40 bg-accent/12 text-accent shadow-[0_8px_24px_rgba(52,120,127,0.12)]"
                    : "border-glass-edge/70 bg-glass/68 text-muted-foreground hover:border-accent/30 hover:text-foreground",
                )}
              >
                {language.label}
              </button>
            ))}
          </div>
        </div>

        {!isSiteNative && (
          <div className="space-y-3 rounded-[24px] border border-glass-edge/60 bg-glass/68 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.063)]">
            <div className="space-y-2">
              <label className="text-xs font-sans uppercase tracking-[0.24em] text-muted-foreground">
                {copy.fields.secondaryLanguage}
              </label>
              <p className="text-sm font-sans text-muted-foreground leading-relaxed">
                {copy.fields.secondaryHint}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {SITE_LANGUAGES.map((code) => {
                const label = ALL_LANGUAGES.find((language) => language.code === code)?.label || code;
                return (
                  <button
                    key={code}
                    type="button"
                    onClick={() => setSecondaryLanguage(code)}
                    className={cn(
                      "rounded-full border px-4 py-2.5 text-sm font-sans transition-all",
                      secondaryLanguage === code
                        ? "border-accent/40 bg-accent/12 text-accent shadow-[0_8px_24px_rgba(52,120,127,0.12)]"
                        : "border-glass-edge/70 bg-glass/68 text-muted-foreground hover:border-accent/30 hover:text-foreground",
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="rounded-[24px] border border-glass-edge/60 bg-glass/68 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.063)]">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <p className="text-xs font-sans uppercase tracking-[0.24em] text-muted-foreground">
                {copy.fields.newsletterTitle}
              </p>
              <p className="text-sm font-sans text-muted-foreground leading-relaxed">
                {copy.fields.newsletterHint}
              </p>
            </div>
            <Switch checked={newsletterSubscribed} onCheckedChange={setNewsletterSubscribed} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProfilePreferencesPanel;
