import type { Config } from "tailwindcss";
import webConfig from "../web/tailwind.config";

/*
 * The data portal shares the main site's design system: the theme is taken from
 * apps/web/tailwind.config.ts as-is rather than re-declared, so the two can't drift.
 * Only `content` (this app's own files) and the data-viz status palette are ours.
 */
const webTheme = webConfig.theme;
const webExtend = webTheme.extend;

export default {
  ...webConfig,
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    ...webTheme,
    extend: {
      ...webExtend,
      colors: {
        ...webExtend.colors,
        "data-blue": "hsl(var(--data-blue))",
        "data-green": "hsl(var(--data-green))",
        "data-amber": "hsl(var(--data-amber))",
        "data-red": "hsl(var(--data-red))",
      },
      keyframes: {
        ...webExtend.keyframes,
        "fade-in": {
          from: { opacity: "0", transform: "translateY(12px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        ...webExtend.animation,
        "fade-in": "fade-in 0.6s ease-out forwards",
      },
    },
  },
} satisfies Config;
