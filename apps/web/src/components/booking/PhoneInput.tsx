import { useId } from "react";
import { featuredPhoneCountries, normalizePhoneNumber, otherPhoneCountries } from "@/lib/phone";

interface PhoneInputProps {
  lang: "it" | "en";
  countryCode: string;
  number: string;
  onChange: (value: { countryCode: string; number: string }) => void;
  /** "glass" matches the profile page, where inputs sit inside a .glass-input wrapper (its
   * ::before layer does not render on a bare <input>/<select>). */
  variant?: "form" | "glass";
}

/**
 * Prefix + number as two controls. The prefix is a native <select> on purpose: on a phone it
 * opens the system picker, which beats any custom dropdown for a 60-item list.
 */
const PhoneInput = ({ lang, countryCode, number, onChange, variant = "form" }: PhoneInputProps) => {
  const id = useId();
  const it = lang === "it";
  const others = otherPhoneCountries(lang);
  const isKnownCode = [...featuredPhoneCountries, ...others].some((country) => country.dialCode === countryCode);
  const glass = variant === "glass";
  const controlClass = glass
    ? "h-14 w-full border-0 bg-transparent text-base md:text-sm shadow-none focus:outline-none"
    : "rounded-2xl border border-border bg-background/70 px-3 py-2 text-base md:text-sm focus:border-accent focus:outline-none";
  const wrap = (className: string, control: JSX.Element) =>
    glass ? <div className={`glass-input rounded-[24px] px-4 ${className}`}>{control}</div> : control;

  return (
    <div className="flex gap-2">
      <label className="sr-only" htmlFor={`${id}-code`}>
        {it ? "Prefisso internazionale" : "International prefix"}
      </label>
      {wrap("w-[8.5rem] shrink-0", <select
        id={`${id}-code`}
        value={countryCode}
        required
        autoComplete="tel-country-code"
        onChange={(event) => onChange({ countryCode: event.target.value, number })}
        className={glass ? controlClass : `w-[7.5rem] shrink-0 ${controlClass}`}
      >
        <option value="" disabled>
          {it ? "Prefisso" : "Prefix"}
        </option>
        {countryCode && !isKnownCode && <option value={countryCode}>{countryCode}</option>}
        {featuredPhoneCountries.map((country) => (
          <option key={country.iso} value={country.dialCode}>
            {country.dialCode} {country[lang]}
          </option>
        ))}
        <option disabled>──────────</option>
        {others.map((country) => (
          <option key={country.iso} value={country.dialCode}>
            {country.dialCode} {country[lang]}
          </option>
        ))}
      </select>)}
      <label className="sr-only" htmlFor={`${id}-number`}>
        {it ? "Numero di telefono" : "Phone number"}
      </label>
      {wrap("min-w-0 flex-1", <input
        id={`${id}-number`}
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        required
        value={number}
        onChange={(event) => {
          const raw = event.target.value;
          // Someone pasting "+39 333 …" into the number field: move the prefix where it belongs.
          const pasted = raw.trim().match(/^(?:\+|00)(\d{1,4})[\s.-]+(.*)$/);
          if (pasted && [...featuredPhoneCountries, ...others].some((c) => c.dialCode === `+${pasted[1]}`)) {
            onChange({ countryCode: `+${pasted[1]}`, number: normalizePhoneNumber(pasted[2]) });
            return;
          }
          onChange({ countryCode, number: raw.replace(/[^0-9\s.-]/g, "") });
        }}
        onBlur={() => onChange({ countryCode, number: normalizePhoneNumber(number) })}
        placeholder={it ? "Es. 333 123 4567" : "E.g. 7700 900123"}
        className={glass ? controlClass : `min-w-0 flex-1 ${controlClass}`}
      />)}
    </div>
  );
};

export default PhoneInput;
