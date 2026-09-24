/**
 * International phone prefixes, split in two parts (prefix + number) the way the forms ask for
 * them. The shape matches public.profile_contact_details and its CHECK constraints: prefix
 * "+<1-4 digits>", number 4-14 digits with no spaces.
 */
export type PhoneCountryOption = {
  /** ISO 3166-1 alpha-2, also used as the stable key: several countries share "+1" or "+7". */
  iso: string;
  dialCode: string;
  it: string;
  en: string;
};

/** Shown first: where BITE travellers actually come from. */
const featuredIsos = ["IT", "GB", "FR", "DE", "ES", "CH", "US", "NL", "GR", "PT"];

const countries: PhoneCountryOption[] = [
  { iso: "IT", dialCode: "+39", it: "Italia", en: "Italy" },
  { iso: "GB", dialCode: "+44", it: "Regno Unito", en: "United Kingdom" },
  { iso: "FR", dialCode: "+33", it: "Francia", en: "France" },
  { iso: "DE", dialCode: "+49", it: "Germania", en: "Germany" },
  { iso: "ES", dialCode: "+34", it: "Spagna", en: "Spain" },
  { iso: "CH", dialCode: "+41", it: "Svizzera", en: "Switzerland" },
  { iso: "US", dialCode: "+1", it: "Stati Uniti / Canada", en: "United States / Canada" },
  { iso: "NL", dialCode: "+31", it: "Paesi Bassi", en: "Netherlands" },
  { iso: "GR", dialCode: "+30", it: "Grecia", en: "Greece" },
  { iso: "PT", dialCode: "+351", it: "Portogallo", en: "Portugal" },
  { iso: "AL", dialCode: "+355", it: "Albania", en: "Albania" },
  { iso: "AR", dialCode: "+54", it: "Argentina", en: "Argentina" },
  { iso: "AU", dialCode: "+61", it: "Australia", en: "Australia" },
  { iso: "AT", dialCode: "+43", it: "Austria", en: "Austria" },
  { iso: "BE", dialCode: "+32", it: "Belgio", en: "Belgium" },
  { iso: "BR", dialCode: "+55", it: "Brasile", en: "Brazil" },
  { iso: "BG", dialCode: "+359", it: "Bulgaria", en: "Bulgaria" },
  { iso: "CL", dialCode: "+56", it: "Cile", en: "Chile" },
  { iso: "CN", dialCode: "+86", it: "Cina", en: "China" },
  { iso: "CO", dialCode: "+57", it: "Colombia", en: "Colombia" },
  { iso: "HR", dialCode: "+385", it: "Croazia", en: "Croatia" },
  { iso: "CY", dialCode: "+357", it: "Cipro", en: "Cyprus" },
  { iso: "CZ", dialCode: "+420", it: "Repubblica Ceca", en: "Czech Republic" },
  { iso: "DK", dialCode: "+45", it: "Danimarca", en: "Denmark" },
  { iso: "EG", dialCode: "+20", it: "Egitto", en: "Egypt" },
  { iso: "EE", dialCode: "+372", it: "Estonia", en: "Estonia" },
  { iso: "FI", dialCode: "+358", it: "Finlandia", en: "Finland" },
  { iso: "HU", dialCode: "+36", it: "Ungheria", en: "Hungary" },
  { iso: "IS", dialCode: "+354", it: "Islanda", en: "Iceland" },
  { iso: "IN", dialCode: "+91", it: "India", en: "India" },
  { iso: "IE", dialCode: "+353", it: "Irlanda", en: "Ireland" },
  { iso: "IL", dialCode: "+972", it: "Israele", en: "Israel" },
  { iso: "JP", dialCode: "+81", it: "Giappone", en: "Japan" },
  { iso: "LV", dialCode: "+371", it: "Lettonia", en: "Latvia" },
  { iso: "LT", dialCode: "+370", it: "Lituania", en: "Lithuania" },
  { iso: "LU", dialCode: "+352", it: "Lussemburgo", en: "Luxembourg" },
  { iso: "MT", dialCode: "+356", it: "Malta", en: "Malta" },
  { iso: "MX", dialCode: "+52", it: "Messico", en: "Mexico" },
  { iso: "MC", dialCode: "+377", it: "Monaco", en: "Monaco" },
  { iso: "ME", dialCode: "+382", it: "Montenegro", en: "Montenegro" },
  { iso: "MA", dialCode: "+212", it: "Marocco", en: "Morocco" },
  { iso: "NZ", dialCode: "+64", it: "Nuova Zelanda", en: "New Zealand" },
  { iso: "NO", dialCode: "+47", it: "Norvegia", en: "Norway" },
  { iso: "PL", dialCode: "+48", it: "Polonia", en: "Poland" },
  { iso: "RO", dialCode: "+40", it: "Romania", en: "Romania" },
  { iso: "RU", dialCode: "+7", it: "Russia", en: "Russia" },
  { iso: "SM", dialCode: "+378", it: "San Marino", en: "San Marino" },
  { iso: "RS", dialCode: "+381", it: "Serbia", en: "Serbia" },
  { iso: "SK", dialCode: "+421", it: "Slovacchia", en: "Slovakia" },
  { iso: "SI", dialCode: "+386", it: "Slovenia", en: "Slovenia" },
  { iso: "ZA", dialCode: "+27", it: "Sudafrica", en: "South Africa" },
  { iso: "KR", dialCode: "+82", it: "Corea del Sud", en: "South Korea" },
  { iso: "SE", dialCode: "+46", it: "Svezia", en: "Sweden" },
  { iso: "TN", dialCode: "+216", it: "Tunisia", en: "Tunisia" },
  { iso: "TR", dialCode: "+90", it: "Turchia", en: "Turkey" },
  { iso: "UA", dialCode: "+380", it: "Ucraina", en: "Ukraine" },
  { iso: "AE", dialCode: "+971", it: "Emirati Arabi Uniti", en: "United Arab Emirates" },
  { iso: "VA", dialCode: "+379", it: "Città del Vaticano", en: "Vatican City" },
];

export const featuredPhoneCountries = featuredIsos
  .map((iso) => countries.find((country) => country.iso === iso))
  .filter((country): country is PhoneCountryOption => Boolean(country));

export const otherPhoneCountries = (lang: "it" | "en") =>
  countries
    .filter((country) => !featuredIsos.includes(country.iso))
    .sort((a, b) => a[lang].localeCompare(b[lang], lang));

const COUNTRY_CODE_PATTERN = /^\+[1-9][0-9]{0,3}$/;
const NUMBER_PATTERN = /^[0-9]{4,14}$/;

/** "0039", "39", "+39 " → "+39". Anything that is not a plausible prefix → "". */
export function normalizePhoneCountryCode(value?: string | null) {
  const digits = (value || "").replace(/[^0-9]/g, "").replace(/^00/, "");
  const candidate = digits ? `+${digits}` : "";
  return COUNTRY_CODE_PATTERN.test(candidate) ? candidate : "";
}

/** Keeps only digits: people type spaces, dashes, dots and brackets. */
export function normalizePhoneNumber(value?: string | null) {
  return (value || "").replace(/[^0-9]/g, "");
}

export function isValidPhone(countryCode?: string | null, number?: string | null) {
  return COUNTRY_CODE_PATTERN.test(normalizePhoneCountryCode(countryCode)) && NUMBER_PATTERN.test(normalizePhoneNumber(number));
}

export function formatPhone(countryCode?: string | null, number?: string | null) {
  const code = normalizePhoneCountryCode(countryCode);
  const digits = normalizePhoneNumber(number);
  if (!code || !digits) return "";
  return `${code} ${digits}`;
}

export type ProfilePhone = { phone_country_code: string | null; phone_number: string | null };

/** PostgREST returns a one-to-one embed as an object, but older clients may type it as an array. */
export function pickProfilePhone(embed: unknown): ProfilePhone | null {
  const row = Array.isArray(embed) ? embed[0] : embed;
  if (!row || typeof row !== "object") return null;
  const value = row as Partial<ProfilePhone>;
  return { phone_country_code: value.phone_country_code ?? null, phone_number: value.phone_number ?? null };
}
