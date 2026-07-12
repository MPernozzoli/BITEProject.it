import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");

const builds = [
  { name: "web", source: "apps/web/dist", destination: "dist" },
  { name: "pack", source: "apps/pack/dist", destination: "dist/pack" },
  { name: "data", source: "apps/data/dist", destination: "dist/Data" },
];

rmSync(dist, { recursive: true, force: true });

for (const build of builds) {
  const source = resolve(root, build.source);
  const destination = resolve(root, build.destination);

  if (!existsSync(source)) {
    throw new Error(`${build.name} build output not found: ${source}`);
  }

  cpSync(source, destination, { recursive: true });

  console.log(`[${build.name}] Copied ${source} -> ${destination}`);
}
