import { useState } from "react";
import type { Language } from "@/lib/i18n";
import {
  candidateLanguageOptions,
  experienceOptions,
  findCandidateLanguageOption,
  getCandidateLanguageLabel,
  languageLevelOptions,
  normalizeCandidateInfo,
  type CandidateInfo,
  type CandidateLanguageLevel,
} from "@/lib/booking-candidate-info";

const sailingKindOptions = [
  { value: "sail", it: "Vela", en: "Sail" },
  { value: "motor", it: "Motore", en: "Motor" },
  { value: "dinghy", it: "Derive / piccole barche", en: "Dinghies / small boats" },
  { value: "crew", it: "Equipaggio / turni", en: "Crew / watches" },
];

const navigationRangeOptions = [
  { value: "coastal_only", it: "Solo costiero", en: "Coastal only" },
  { value: "some_offshore", it: "Qualche altura", en: "Some offshore" },
  { value: "offshore_familiar", it: "Altura familiare", en: "Familiar with offshore" },
  { value: "ocean", it: "Traversate lunghe", en: "Long passages" },
];

const ageRangeOptions = [
  { value: "18_24", label: "18-24" },
  { value: "25_34", label: "25-34" },
  { value: "35_44", label: "35-44" },
  { value: "45_54", label: "45-54" },
  { value: "55_plus", label: "55+" },
];

const primaryLanguageOptions = candidateLanguageOptions.filter((option) => option.primary);
const extraLanguageOptions = candidateLanguageOptions.filter((option) => !option.primary);

const workOptions = [
  { value: "no", it: "No, stacco", en: "No, I will disconnect" },
  { value: "light", it: "Poco, qualche call/mail", en: "Lightly, a few calls/emails" },
  { value: "regular", it: "Si, lavoro da remoto", en: "Yes, remote work" },
  { value: "unknown", it: "Non lo so ancora", en: "I do not know yet" },
];

const foodOptions = [
  { value: "none", it: "Nessun regime", en: "No special diet" },
  { value: "vegetarian", it: "Vegetariano", en: "Vegetarian" },
  { value: "vegan", it: "Vegano", en: "Vegan" },
  { value: "gluten_free", it: "Senza glutine", en: "Gluten free" },
  { value: "lactose_free", it: "Senza lattosio", en: "Lactose free" },
  { value: "allergies", it: "Allergie / intolleranze", en: "Allergies / intolerances" },
];

const toggleListValue = (list: string[], value: string) =>
  list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

const nextLanguageLevel = (current?: CandidateLanguageLevel) => {
  if (!current) return languageLevelOptions[0].value;
  const index = languageLevelOptions.findIndex((option) => option.value === current);
  return languageLevelOptions[(index + 1) % languageLevelOptions.length].value;
};

interface CandidateInfoFormProps {
  value: CandidateInfo;
  onChange: (value: CandidateInfo) => void;
  lang: Language;
  compact?: boolean;
}

const CandidateInfoForm = ({ value, onChange, lang, compact = false }: CandidateInfoFormProps) => {
  const [otherLanguageInput, setOtherLanguageInput] = useState("");
  const normalizedValue = normalizeCandidateInfo(value);
  const experience = experienceOptions.find((option) => option.value === normalizedValue.sailingExperienceLevel) ?? experienceOptions[2];
  const update = <Key extends keyof CandidateInfo>(key: Key, nextValue: CandidateInfo[Key]) => {
    onChange({ ...normalizedValue, [key]: nextValue });
  };

  const toggleLanguage = (language: string) => {
    const selected = normalizedValue.languages.includes(language);
    if (!selected) {
      onChange({
        ...normalizedValue,
        languages: [...normalizedValue.languages, language],
        languageLevels: {
          ...normalizedValue.languageLevels,
          [language]: nextLanguageLevel(),
        },
      });
      return;
    }

    const currentLevel = normalizedValue.languageLevels[language];
    const nextLevel = nextLanguageLevel(currentLevel);
    onChange({
      ...normalizedValue,
      languageLevels: {
        ...normalizedValue.languageLevels,
        [language]: nextLevel,
      },
    });
  };

  const addOtherLanguage = () => {
    const trimmed = otherLanguageInput.trim();
    if (!trimmed) return;
    const matchedLanguage = findCandidateLanguageOption(trimmed);
    if (matchedLanguage) {
      if (!normalizedValue.languages.includes(matchedLanguage.value)) {
        onChange({
          ...normalizedValue,
          languages: [...normalizedValue.languages.filter((language) => language !== "other"), matchedLanguage.value],
          languageLevels: {
            ...normalizedValue.languageLevels,
            [matchedLanguage.value]: nextLanguageLevel(),
          },
        });
      }
      setOtherLanguageInput("");
      return;
    }

    const nextOtherLanguages = normalizedValue.otherLanguages
      ? `${normalizedValue.otherLanguages}, ${trimmed}`
      : trimmed;
    onChange({
      ...normalizedValue,
      languages: normalizedValue.languages.filter((language) => language !== "other"),
      otherLanguages: nextOtherLanguages,
    });
    setOtherLanguageInput("");
  };

  const additionalSelectedLanguages = normalizedValue.languages
    .filter((language) => language !== "other")
    .map((language) => candidateLanguageOptions.find((option) => option.value === language))
    .filter((option): option is (typeof candidateLanguageOptions)[number] => Boolean(option))
    .filter((option) => !option.primary);

  const chipClass = (selected: boolean) =>
    `rounded-full border px-3 py-2 text-xs font-medium transition-colors ${
      selected
        ? "border-foreground bg-foreground text-background"
        : "border-border/70 bg-background/55 text-muted-foreground hover:text-foreground"
    }`;

  return (
    <div className={compact ? "space-y-4" : "space-y-5"}>
      <fieldset className="space-y-3">
        <legend className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          {lang === "it" ? "Esperienza nautica" : "Sailing experience"}
        </legend>
        <div className="rounded-[22px] border border-border/70 bg-background/55 p-4">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-medium text-foreground">
              {lang === "it" ? experience.it : experience.en}
            </span>
            <span className="text-xs text-muted-foreground">{normalizedValue.sailingExperienceLevel + 1}/{experienceOptions.length}</span>
          </div>
          <input
            type="range"
            min={0}
            max={experienceOptions.length - 1}
            step={1}
            value={normalizedValue.sailingExperienceLevel}
            onChange={(event) => update("sailingExperienceLevel", Number(event.target.value))}
            className="mt-4 w-full accent-[hsl(var(--accent))]"
            aria-label={lang === "it" ? "Livello esperienza nautica" : "Sailing experience level"}
          />
          <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
            <span>{lang === "it" ? "Prima volta" : "First time"}</span>
            <span>{lang === "it" ? "Esperto" : "Expert"}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {sailingKindOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => update("sailingKinds", toggleListValue(normalizedValue.sailingKinds, option.value))}
              className={chipClass(normalizedValue.sailingKinds.includes(option.value))}
            >
              {lang === "it" ? option.it : option.en}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {navigationRangeOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => update("navigationRange", option.value)}
              className={chipClass(normalizedValue.navigationRange === option.value)}
            >
              {lang === "it" ? option.it : option.en}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          {lang === "it" ? "Eta e lingue" : "Age and languages"}
        </legend>
        <div className="flex flex-wrap gap-2">
          {ageRangeOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => update("ageRange", option.value)}
              className={chipClass(normalizedValue.ageRange === option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="rounded-[18px] border border-border/70 bg-background/45 p-3">
          <p className="mb-2 text-xs leading-relaxed text-muted-foreground">
            {lang === "it"
              ? "Premi una lingua piu volte per aumentare il livello scelto."
              : "Press a language repeatedly to increase the selected level."}
          </p>
          <div className="flex flex-wrap gap-2">
            {primaryLanguageOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => toggleLanguage(option.value)}
                className={[
                  "rounded-full border px-3 py-2 text-left text-xs font-medium transition-colors",
                  normalizedValue.languages.includes(option.value)
                    ? "border-foreground bg-foreground text-background"
                    : "border-border/70 bg-background/55 text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                <span className="block">{option.label}</span>
                {normalizedValue.languages.includes(option.value) && (
                  <span className="mt-0.5 block text-[10px] opacity-80">
                    {languageLevelOptions.find((level) => level.value === normalizedValue.languageLevels[option.value])?.[lang] ||
                      (lang === "it" ? "Principiante" : "Beginner")}
                  </span>
                )}
              </button>
            ))}
          </div>
          {(additionalSelectedLanguages.length > 0 || normalizedValue.otherLanguages) && (
            <div className="mt-3 border-t border-border/60 pt-3">
              {additionalSelectedLanguages.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {additionalSelectedLanguages.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => toggleLanguage(option.value)}
                      className="rounded-full border border-foreground bg-foreground px-3 py-2 text-left text-xs font-medium text-background transition-colors"
                    >
                      <span className="block">{getCandidateLanguageLabel(option.value)}</span>
                      <span className="mt-0.5 block text-[10px] opacity-80">
                        {languageLevelOptions.find((level) => level.value === normalizedValue.languageLevels[option.value])?.[lang] ||
                          (lang === "it" ? "Principiante" : "Beginner")}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {normalizedValue.otherLanguages && (
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {lang === "it" ? "Altre lingue non in elenco: " : "Other languages not listed: "}
                  <span className="text-foreground">{normalizedValue.otherLanguages}</span>
                </p>
              )}
            </div>
          )}
          <label className="mt-3 block">
            <span className="mb-1 block text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              {lang === "it" ? "Aggiungi altra lingua" : "Add another language"}
            </span>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                list="candidate-language-suggestions"
                value={otherLanguageInput}
                onChange={(event) => setOtherLanguageInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addOtherLanguage();
                  }
                }}
                placeholder={lang === "it" ? "Es. russo, turco, cinese..." : "E.g. Russian, Turkish, Chinese..."}
                className="min-w-0 flex-1 rounded-2xl border border-border bg-background/70 px-3 py-2 text-sm focus:border-accent focus:outline-none"
              />
              <button
                type="button"
                onClick={addOtherLanguage}
                className="rounded-full border border-border/70 px-4 py-2 text-xs font-semibold text-foreground transition-colors hover:border-foreground"
              >
                {lang === "it" ? "Aggiungi" : "Add"}
              </button>
            </div>
            <datalist id="candidate-language-suggestions">
              {extraLanguageOptions.map((option) => (
                <option key={option.value} value={option.label} />
              ))}
            </datalist>
          </label>
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          {lang === "it" ? "Lavoro e bordo" : "Work and life aboard"}
        </legend>
        <div className="flex flex-wrap gap-2">
          {workOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => update("workDuringVoyage", option.value)}
              className={chipClass(normalizedValue.workDuringVoyage === option.value)}
            >
              {lang === "it" ? option.it : option.en}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          {lang === "it" ? "Cibo e allergie" : "Food and allergies"}
        </legend>
        <div className="flex flex-wrap gap-2">
          {foodOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => update("foodRegimes", toggleListValue(normalizedValue.foodRegimes, option.value))}
              className={chipClass(normalizedValue.foodRegimes.includes(option.value))}
            >
              {lang === "it" ? option.it : option.en}
            </button>
          ))}
        </div>
        {normalizedValue.foodRegimes.includes("allergies") && (
          <label className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              {lang === "it" ? "Dettagli allergie" : "Allergy details"}
            </span>
            <input
              value={normalizedValue.allergies}
              onChange={(event) => update("allergies", event.target.value)}
              className="w-full rounded-2xl border border-border bg-background/70 px-3 py-2 text-sm focus:border-accent focus:outline-none"
            />
          </label>
        )}
      </fieldset>

      <label className="block">
        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          {lang === "it" ? "Perche vorresti partecipare" : "Why you would like to join"}
        </span>
        <textarea
          value={normalizedValue.motivation}
          onChange={(event) => update("motivation", event.target.value)}
          rows={compact ? 3 : 4}
          minLength={20}
          className="w-full resize-y rounded-2xl border border-border bg-background/70 px-3 py-2 text-sm leading-relaxed focus:border-accent focus:outline-none"
          placeholder={
            lang === "it"
              ? "Raccontaci cosa ti porta a bordo e cosa pensi di poter condividere con l'equipaggio."
              : "Tell us what brings you aboard and what you think you can share with the crew."
          }
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          {lang === "it" ? "Altre note" : "Other notes"}
        </span>
        <textarea
          value={normalizedValue.notes}
          onChange={(event) => update("notes", event.target.value)}
          rows={compact ? 2 : 3}
          className="w-full resize-y rounded-2xl border border-border bg-background/70 px-3 py-2 text-sm leading-relaxed focus:border-accent focus:outline-none"
        />
      </label>
    </div>
  );
};

export default CandidateInfoForm;
