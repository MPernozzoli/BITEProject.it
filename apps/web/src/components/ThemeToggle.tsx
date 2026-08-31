import { Monitor, Moon, Sun } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useTheme, type ThemePreference } from "@/lib/theme";
import { cn } from "@/lib/utils";

/**
 * Interruttore chiaro/scuro della navbar. Un tap solo: chi vuole "segui il
 * sistema" lo trova in ThemeChoice, dentro i menu.
 */
export const ThemeToggle = ({ className }: { className?: string }) => {
  const { t } = useI18n();
  const { resolvedTheme, toggleTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? t("theme.toLight") : t("theme.toDark")}
      title={isDark ? t("theme.toLight") : t("theme.toDark")}
      className={cn(
        "touch-target-44 inline-flex items-center justify-center rounded-full transition-[color,background-color,border-color,transform] duration-300 ease-out-expo active:scale-[0.98]",
        className,
      )}
    >
      {isDark ? <Moon size={16} aria-hidden /> : <Sun size={16} aria-hidden />}
    </button>
  );
};

const OPTIONS: { value: ThemePreference; icon: typeof Sun; labelKey: string }[] = [
  { value: "light", icon: Sun, labelKey: "theme.light" },
  { value: "dark", icon: Moon, labelKey: "theme.dark" },
  { value: "system", icon: Monitor, labelKey: "theme.system" },
];

/**
 * Scelta a tre stati, per i menu. "Sistema" non è un terzo colore ma l'assenza
 * di scelta: il sito segue l'impostazione del dispositivo, anche se cambia
 * mentre la pagina è aperta.
 */
export const ThemeChoice = ({ className }: { className?: string }) => {
  const { t } = useI18n();
  const { theme, setTheme } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label={t("theme.label")}
      className={cn(
        "grid grid-cols-3 gap-1 rounded-2xl border border-border/70 bg-muted/50 p-1",
        className,
      )}
    >
      {OPTIONS.map(({ value, icon: Icon, labelKey }) => {
        const active = theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setTheme(value)}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-xl px-2 py-2 font-sans text-xs transition-colors",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon size={14} aria-hidden />
            <span>{t(labelKey)}</span>
          </button>
        );
      })}
    </div>
  );
};

export default ThemeToggle;
