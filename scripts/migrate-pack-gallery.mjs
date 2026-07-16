#!/usr/bin/env node
/**
 * One-shot migration: moves the pack gallery off the hardcoded list in
 * apps/pack/src/data/site.ts into the `pack-gallery` bucket + pack_gallery_photos table.
 *
 * Reads the current galleryItems manifest (src/category/alt), uploads each source file from
 * apps/pack/public into the bucket, and inserts a matching row. Idempotent: the storage path
 * is derived from the source path, storage upload uses upsert, and rows are upserted on the
 * unique storage_path, so re-running does not duplicate anything.
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.
 *
 *   node scripts/migrate-pack-gallery.mjs
 */
import { readFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PACK_SRC = path.join(ROOT, "apps/pack/src/data");
const PACK_PUBLIC = path.join(ROOT, "apps/pack/public");
const BUCKET = "pack-gallery";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the environment.");
  process.exit(1);
}

const MIME_BY_EXT = {
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".avif": "image/avif",
};

/** Extracts every `key: "value"` pair from a `const NAME = { ... }` block into NAME.key -> value. */
const parsePhotoMaps = (source) => {
  const lookup = new Map();
  const blockRe = /export const (\w+)\s*=\s*{([\s\S]*?)}\s*as const;/g;
  let block;
  while ((block = blockRe.exec(source)) !== null) {
    const [, mapName, body] = block;
    const entryRe = /(\w+)\s*:\s*"([^"]+)"/g;
    let entry;
    while ((entry = entryRe.exec(body)) !== null) {
      lookup.set(`${mapName}.${entry[1]}`, entry[2]);
    }
  }
  return lookup;
};

/** Parses the galleryItems array into { ref, category, alt } records. */
const parseGalleryItems = (source) => {
  const arrMatch = source.match(/export const galleryItems\s*=\s*\[([\s\S]*?)\];/);
  if (!arrMatch) throw new Error("galleryItems array not found in site.ts");
  const items = [];
  const entryRe =
    /{\s*src:\s*([\w.]+)\s*,\s*category:\s*"([^"]+)"\s*,\s*alt:\s*"([^"]*)"\s*}/g;
  let entry;
  while ((entry = entryRe.exec(arrMatch[1])) !== null) {
    items.push({ ref: entry[1], category: entry[2], alt: entry[3] });
  }
  return items;
};

const readFileAsBuffer = (absPath) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    createReadStream(absPath)
      .on("data", (chunk) => chunks.push(chunk))
      .on("end", () => resolve(Buffer.concat(chunks)))
      .on("error", reject);
  });

const main = async () => {
  const [photosSource, siteSource] = await Promise.all([
    readFile(path.join(PACK_SRC, "photos.ts"), "utf8"),
    readFile(path.join(PACK_SRC, "site.ts"), "utf8"),
  ]);

  const photoLookup = parsePhotoMaps(photosSource);
  const items = parseGalleryItems(siteSource);
  console.log(`Found ${items.length} gallery items to migrate.`);

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  let order = 0;
  let migrated = 0;
  let skipped = 0;

  for (const item of items) {
    order += 1;
    const publicPath = photoLookup.get(item.ref);
    if (!publicPath) {
      console.warn(`  ! Could not resolve ${item.ref}, skipping.`);
      skipped += 1;
      continue;
    }

    // "/photos/godot/g.webp" -> gallery/godot__g.webp: flat, collision-free, deterministic.
    const relative = publicPath.replace(/^\//, "");
    const storagePath = `gallery/${relative.replace(/^photos\//, "").replace(/\//g, "__")}`;
    const ext = path.extname(publicPath).toLowerCase();
    const contentType = MIME_BY_EXT[ext] ?? "application/octet-stream";
    const absPath = path.join(PACK_PUBLIC, relative);

    let buffer;
    try {
      buffer = await readFileAsBuffer(absPath);
    } catch {
      console.warn(`  ! Missing file on disk: ${absPath}, skipping.`);
      skipped += 1;
      continue;
    }

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, buffer, { contentType, cacheControl: "31536000", upsert: true });
    if (uploadError) {
      console.error(`  ! Upload failed for ${storagePath}: ${uploadError.message}`);
      skipped += 1;
      continue;
    }

    const { error: upsertError } = await supabase
      .from("pack_gallery_photos")
      .upsert(
        {
          storage_path: storagePath,
          category: item.category,
          alt: item.alt,
          sort_order: order,
          is_published: true,
        },
        { onConflict: "storage_path" }
      );
    if (upsertError) {
      console.error(`  ! Row upsert failed for ${storagePath}: ${upsertError.message}`);
      skipped += 1;
      continue;
    }

    migrated += 1;
    console.log(`  ✓ ${storagePath} (${item.category})`);
  }

  console.log(`\nDone. Migrated ${migrated}, skipped ${skipped}.`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
