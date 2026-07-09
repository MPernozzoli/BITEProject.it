import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const subapps = [
  { name: "pack", source: "apps/pack/dist", destination: "dist/_pack" },
  { name: "data", source: "apps/data/dist", destination: "dist/_data" },
];

for (const subapp of subapps) {
  const source = resolve(root, subapp.source);
  const destination = resolve(root, subapp.destination);

  if (!existsSync(source)) {
    throw new Error(`${subapp.name} build output not found: ${source}`);
  }

  rmSync(destination, { recursive: true, force: true });
  cpSync(source, destination, { recursive: true });

  console.log(`[${subapp.name}] Copied ${source} -> ${destination}`);
}
