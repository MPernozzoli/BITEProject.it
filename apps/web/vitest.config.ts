import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
  resolve: {
    // Gli stessi alias di `vite.config.ts`: un test che importa `@shared/...`
    // deve risolverlo come lo risolve il bundle, altrimenti il file non si
    // carica nemmeno e la suite lo conta come fallimento invece che come test.
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@shared": path.resolve(__dirname, "../../shared"),
    },
  },
});
