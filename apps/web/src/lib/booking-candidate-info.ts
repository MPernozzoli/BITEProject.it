export type CandidateInfo = {
  sailingExperienceLevel: number;
  sailingKinds: string[];
  navigationRange: string;
  ageRange: string;
  languages: string[];
  languageLevels: Record<string, CandidateLanguageLevel>;
  otherLanguages: string;
  workDuringVoyage: string;
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
  sailingExperienceLevel: 2,
  sailingKinds: [],
  navigationRange: "",
  ageRange: "",
  languages: [],
  languageLevels: {},
  otherLanguages: "",
  workDuringVoyage: "",
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
  "sailingExperienceLevel",
  "sailingKinds",
  "navigationRange",
  "ageRange",
  "languages",
  "languageLevels",
  "otherLanguages",
  "workDuringVoyage",
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
  };
}

export function buildCandidateInfoPrefill(params: {
  latestCandidateInfo?: Partial<CandidateInfo> | null;
  preferredLanguage?: string | null;
  secondaryLanguage?: string | null;
}) {
  const latest = normalizeCandidateInfo(params.latestCandidateInfo);
  const next = { ...emptyCandidateInfo };
  for (const key of reusableCandidateKeys) {
    (next[key] as CandidateInfo[typeof key]) = latest[key] as CandidateInfo[typeof key];
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
