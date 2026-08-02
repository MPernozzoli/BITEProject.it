/**
 * Punto unico di ancoraggio a `@pynkstudio/newsletterapp` per le edge function.
 *
 * Deno risolve i specifier alla lettera, quindi non può usare `dist/` (che è
 * scritto con estensioni `.js` per Node ESM): il package pubblica un albero
 * gemello `deno/` con estensioni `.ts`, che si importa via URL.
 *
 * **Il tag è pinnato qui e solo qui.** Le edge function vengono deployate
 * separatamente dall'app web: puntare a `main` cambierebbe il comportamento
 * senza un deploy. Per aggiornare il package si tocca `NEWSLETTERAPP_VERSION`
 * in questo file e si riesegue il deploy delle function.
 *
 * La versione npm in `apps/web/package.json` (route Vercel e console admin)
 * deve restare allineata a questa.
 */

export * from "https://raw.githubusercontent.com/PynkStudio/pynkstudio-newsletterapp/v0.1.2/deno/core/index.ts";
export * from "https://raw.githubusercontent.com/PynkStudio/pynkstudio-newsletterapp/v0.1.2/deno/server/index.ts";
export * from "https://raw.githubusercontent.com/PynkStudio/pynkstudio-newsletterapp/v0.1.2/deno/http/index.ts";

/** Tenuta come costante per rendere greppabile la versione in uso. */
export const NEWSLETTERAPP_VERSION = 'v0.1.2'

