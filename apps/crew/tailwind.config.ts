import type { Config } from "tailwindcss";
import webConfig from "../web/tailwind.config";

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
        "crew-ink": "hsl(var(--crew-ink))",
        "crew-sea": "hsl(var(--crew-sea))",
        "crew-signal": "hsl(var(--crew-signal))",
      },
    },
  },
} satisfies Config;
