import { isValidPhone, normalizePhoneCountryCode, normalizePhoneNumber, type ProfilePhone } from "@/lib/phone";

export type CandidateInfo = {
  /** "+39". Also saved to the profile (profile_contact_details) by a trigger on the request. */
  phoneCountryCode: string;
  /** Digits only, without the prefix. */
  phoneNumber: string;
  sailingExperienceLevel: number;
  sailingKinds: string[];
  navigationRange: string;
  ageRange: string;
  languages: string[];
  languageLevels: Record<string, CandidateLanguageLevel>;
  otherLanguages: string;
  workDuringVoyage: string;
  workRole: string;
  foodRegimes: string[];
  allergies: string;
  motivation: string;
  notes: string;
};

export type CandidateLanguageLevel = "beginner" | "conversational" | "advanced" | "native";

export type CandidateLanguageOption = {
  value: string;
  label: string;
  aliases: string[];
  primary?: boolean;
};

export const candidateLanguageOptions: CandidateLanguageOption[] = [
  { value: "it", label: "Italiano", aliases: ["it", "italiano", "italian"], primary: true },
  { value: "en", label: "English", aliases: ["en", "english", "inglese"], primary: true },
  { value: "fr", label: "Francais", aliases: ["fr", "francese", "francais", "french"], primary: true },
  { value: "es", label: "Espanol", aliases: ["es", "spagnolo", "espanol", "spanish"], primary: true },
  { value: "de", label: "Deutsch", aliases: ["de", "tedesco", "deutsch", "german"], primary: true },
  { value: "pt", label: "Portugues", aliases: ["pt", "portoghese", "portugues", "portuguese"], primary: true },
  { value: "ru", label: "Russo", aliases: ["ru", "russo", "russian"] },
  { value: "tr", label: "Turco", aliases: ["tr", "turco", "turkish"] },
  { value: "zh", label: "Cinese", aliases: ["zh", "cn", "cinese", "mandarino", "mandarin", "chinese"] },
  { value: "ar", label: "Arabo", aliases: ["ar", "arabo", "arabic"] },
  { value: "nl", label: "Olandese", aliases: ["nl", "olandese", "dutch", "neerlandese"] },
  { value: "sv", label: "Svedese", aliases: ["sv", "svedese", "swedish"] },
  { value: "no", label: "Norvegese", aliases: ["no", "norvegese", "norwegian"] },
  { value: "da", label: "Danese", aliases: ["da", "danese", "danish"] },
  { value: "pl", label: "Polacco", aliases: ["pl", "polacco", "polish"] },
  { value: "uk", label: "Ucraino", aliases: ["uk", "ucraino", "ukrainian"] },
  { value: "ro", label: "Rumeno", aliases: ["ro", "rumeno", "romeno", "romanian"] },
  { value: "el", label: "Greco", aliases: ["el", "greco", "greek"] },
  { value: "ja", label: "Giapponese", aliases: ["ja", "giapponese", "japanese"] },
  { value: "ko", label: "Coreano", aliases: ["ko", "coreano", "korean"] },
];

const normalizeLanguageSearch = (value?: string | null) =>
  value
    ?.trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") || "";

export const getCandidateLanguageLabel = (value: string) =>
  candidateLanguageOptions.find((option) => option.value === value)?.label || value.toUpperCase();

export const findCandidateLanguageOption = (value?: string | null) => {
  const normalized = normalizeLanguageSearch(value);
  if (!normalized) return null;
  return (
    candidateLanguageOptions.find((option) => option.value === normalized || option.aliases.some((alias) => normalizeLanguageSearch(alias) === normalized)) ||
    null
  );
};

export const emptyCandidateInfo: CandidateInfo = {
  phoneCountryCode: "",
  phoneNumber: "",
  sailingExperienceLevel: 2,
  sailingKinds: [],
  navigationRange: "",
  ageRange: "",
  languages: [],
  languageLevels: {},
  otherLanguages: "",
  workDuringVoyage: "",
  workRole: "",
  foodRegimes: [],
  allergies: "",
  motivation: "",
  notes: "",
};

export const experienceOptions = [
  { value: 0, it: "Sarebbe la mia prima volta", en: "It would be my first time" },
  { value: 1, it: "Uscite in pedalo valgono?", en: "Do pedal boats count?" },
  { value: 2, it: "Ho navigato una volta", en: "I sailed once" },
  { value: 3, it: "Ho un po' di esperienza", en: "I have some experience" },
  { value: 4, it: "Sono familiare", en: "I feel familiar with boats" },
  { value: 5, it: "Mi considero esperto", en: "I consider myself experienced" },
  { value: 6, it: "Chiamatemi Jack Sparrow", en: "Call me Jack Sparrow" },
];

export const languageLevelOptions: Array<{ value: CandidateLanguageLevel; it: string; en: string }> = [
  { value: "beginner", it: "Principiante", en: "Beginner" },
  { value: "conversational", it: "Me la cavo", en: "I get by" },
  { value: "advanced", it: "Esperto", en: "Advanced" },
  { value: "native", it: "Madrelingua", en: "Native" },
];

const reusableCandidateKeys: Array<keyof CandidateInfo> = [
  "phoneCountryCode",
  "phoneNumber",
  "sailingExperienceLevel",
  "sailingKinds",
  "navigationRange",
  "ageRange",
  "languages",
  "languageLevels",
  "otherLanguages",
  "workDuringVoyage",
  "workRole",
  "foodRegimes",
  "allergies",
];

const normalizeLanguageCode = (value?: string | null) => {
  const code = value?.trim().toLowerCase();
  if (!code) return null;
  const exact = findCandidateLanguageOption(code);
  if (exact) return exact.value;
  return candidateLanguageOptions.find((option) => code.startsWith(option.value))?.value || null;
};

export function normalizeCandidateInfo(value?: Partial<CandidateInfo> | null): CandidateInfo {
  return {
    ...emptyCandidateInfo,
    ...(value || {}),
    sailingKinds: Array.isArray(value?.sailingKinds) ? value.sailingKinds : [],
    languages: Array.isArray(value?.languages) ? value.languages : [],
    languageLevels: value?.languageLevels && typeof value.languageLevels === "object" ? value.languageLevels : {},
    foodRegimes: Array.isArray(value?.foodRegimes) ? value.foodRegimes : [],
    phoneCountryCode: typeof value?.phoneCountryCode === "string" ? value.phoneCountryCode : "",
    phoneNumber: typeof value?.phoneNumber === "string" ? value.phoneNumber : "",
  };
}

export function buildCandidateInfoPrefill(params: {
  latestCandidateInfo?: Partial<CandidateInfo> | null;
  preferredLanguage?: string | null;
  secondaryLanguage?: string | null;
  /** The phone saved on the profile wins over the one in the last application: it may have been
   * corrected from the profile page since. */
  profilePhone?: ProfilePhone | null;
}) {
  const latest = normalizeCandidateInfo(params.latestCandidateInfo);
  const next = { ...emptyCandidateInfo };
  for (const key of reusableCandidateKeys) {
    (next[key] as CandidateInfo[typeof key]) = latest[key] as CandidateInfo[typeof key];
  }
  if (isValidPhone(params.profilePhone?.phone_country_code, params.profilePhone?.phone_number)) {
    next.phoneCountryCode = normalizePhoneCountryCode(params.profilePhone?.phone_country_code);
    next.phoneNumber = normalizePhoneNumber(params.profilePhone?.phone_number);
  }
  // Nothing known yet: an Italian-speaking profile most likely has an Italian number. The prefix
  // stays visible and editable, so this saves a tap without deciding anything silently.
  if (!next.phoneCountryCode && normalizeLanguageCode(params.preferredLanguage) === "it") {
    next.phoneCountryCode = "+39";
  }

  const profileLanguages = [params.preferredLanguage, params.secondaryLanguage]
    .map(normalizeLanguageCode)
    .filter((value): value is string => Boolean(value));
  const languages = [...new Set([...next.languages, ...profileLanguages])];
  const languageLevels = { ...next.languageLevels };
  for (const language of profileLanguages) {
    if (!languageLevels[language]) languageLevels[language] = "conversational";
  }

  return {
    ...next,
    languages,
    languageLevels,
    motivation: "",
    notes: "",
  };
}

export function getCandidateInfoValidationError(
  value: CandidateInfo,
  lang: "it" | "en"
) {
  const candidateInfo = normalizeCandidateInfo(value);
  const hasKnownLanguage = candidateInfo.languages.length > 0;
  const hasOtherLanguage = candidateInfo.otherLanguages.trim().length > 0;

  if (!normalizePhoneCountryCode(candidateInfo.phoneCountryCode)) {
    return lang === "it" ? "Scegli il prefisso internazionale del tuo telefono." : "Choose your phone's international prefix.";
  }
  if (!isValidPhone(candidateInfo.phoneCountryCode, candidateInfo.phoneNumber)) {
    return lang === "it"
      ? "Inserisci un numero di telefono valido (solo cifre, senza prefisso)."
      : "Enter a valid phone number (digits only, without the prefix).";
  }

  if (!candidateInfo.ageRange) {
    return lang === "it" ? "Seleziona la tua fascia d'eta." : "Select your age range.";
  }
  if (!hasKnownLanguage && !hasOtherLanguage) {
    return lang === "it" ? "Indica almeno una lingua che parli." : "Add at least one language you speak.";
  }
  if (!candidateInfo.workDuringVoyage) {
    return lang === "it"
      ? "Indica se lavorerai durante il viaggio."
      : "Select whether you will work during the voyage.";
  }
  if (candidateInfo.foodRegimes.length === 0) {
    return lang === "it"
      ? "Seleziona almeno un regime alimentare."
      : "Select at least one food preference.";
  }
  if (candidateInfo.foodRegimes.includes("allergies") && candidateInfo.allergies.trim().length === 0) {
    return lang === "it"
      ? "Aggiungi i dettagli delle allergie o intolleranze."
      : "Add details about your allergies or intolerances.";
  }
  if (candidateInfo.motivation.trim().length < 20) {
    return lang === "it"
      ? "Scrivi qualche riga sul perche vorresti partecipare."
      : "Write a few lines about why you would like to join.";
  }

  return null;
}

/**
 * Drafts saved before the phone field existed (and drafts restored after the prefill arrived)
 * come back without a phone: take it from the prefill. Only when both halves are empty, so a
 * traveller who is retyping their number is never overwritten. Returns the same object when
 * nothing changes, so it is safe inside a state updater.
 */
export function withPhoneFallback(current: CandidateInfo, prefill: CandidateInfo): CandidateInfo {
  if (current.phoneCountryCode || current.phoneNumber) return current;
  if (!prefill.phoneCountryCode && !prefill.phoneNumber) return current;
  return { ...current, phoneCountryCode: prefill.phoneCountryCode, phoneNumber: prefill.phoneNumber };
}
