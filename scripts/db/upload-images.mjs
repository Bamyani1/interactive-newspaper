#!/usr/bin/env node

/**
 * Optimize only referenced OCR crops, content-address them, upload them to R2,
 * and prune failed references before public promotion.
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, extname, join, normalize, relative, resolve } from "node:path";
import { parseArgs } from "node:util";

const MAX_ASSET_BYTES = 500 * 1024;
const MAX_LONG_EDGE = 2000;
const DIMENSION_FLOOR = 1400;
const WARN_EDITION_BYTES = 15 * 1024 * 1024;
const MAX_EDITION_BYTES = 25 * 1024 * 1024;
const QUALITY_STEPS = [85, 80, 75];

const { values } = parseArgs({
  options: {
    date: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    force: { type: "boolean", default: false },
    "editions-dir": { type: "string" },
  },
  strict: true,
});

if (!values.date || !/^\d{4}-\d{2}-\d{2}$/.test(values.date)) {
  console.error("Usage: node scripts/db/upload-images.mjs --date YYYY-MM-DD [--editions-dir DIR] [--dry-run]");
  process.exit(1);
}

const date = values.date;
const dryRun = values["dry-run"];
const rootDir = resolve(import.meta.dirname, "../..");
const editionsDir = resolve(values["editions-dir"] || join(rootDir, "public/editions"));
const editionDir = join(editionsDir, date);
const editionPath = join(editionDir, "edition.json");
const imagesDir = join(editionDir, "images");

if (!existsSync(editionPath)) {
  console.error(`ERROR: edition.json not found: ${editionPath}`);
  process.exit(1);
}

function loadEnvLocal() {
  const envPath = join(rootDir, ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const splitAt = trimmed.indexOf("=");
    if (splitAt < 1) continue;
    const key = trimmed.slice(0, splitAt);
    const value = trimmed.slice(splitAt + 1).replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function atomicJson(path, value) {
  const partial = `${path}.part`;
  writeFileSync(partial, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(partial, path);
}

function safeLocalImagePath(reference) {
  if (typeof reference !== "string" || !reference.trim()) return null;
  if (/^[a-z]+:\/\//i.test(reference)) return null;
  const resolved = resolve(editionDir, normalize(reference));
  const withinEdition = relative(editionDir, resolved);
  if (withinEdition.startsWith("..") || withinEdition === "") return null;
  return resolved;
}

function collectReferences(edition) {
  const references = [];
  const addArray = (owner, kind) => {
    if (!Array.isArray(owner?.image_files)) return;
    owner.image_files.forEach((value, index) => references.push({ owner, kind, index, value }));
  };
  for (const article of edition.articles || []) addArray(article, "article");
  for (const ad of edition.ads || []) addArray(ad, "ad");
  for (const ad of edition.enriched_ads || []) addArray(ad, "enriched_ad");
  for (const item of edition.other_content || []) {
    if (typeof item?.body === "string" && /^images\//.test(item.body)) {
      references.push({ owner: item, kind: "standalone", index: -1, value: item.body });
    }
  }
  return references;
}

function removeFailedReferences(edition, failedValues) {
  const cleanOwner = (owner, alignImages = false) => {
    const files = Array.isArray(owner.image_files) ? owner.image_files : [];
    const images = Array.isArray(owner.images) ? owner.images : [];
    const keptFiles = [];
    const keptImages = [];
    files.forEach((file, index) => {
      if (failedValues.has(file)) return;
      keptFiles.push(file);
      if (alignImages) keptImages.push(images[index] || { caption: "", position: "" });
    });
    owner.image_files = keptFiles;
    if (alignImages) owner.images = keptImages;
  };
  for (const article of edition.articles || []) cleanOwner(article, true);
  for (const ad of edition.ads || []) cleanOwner(ad);
  for (const ad of edition.enriched_ads || []) cleanOwner(ad);
  edition.other_content = (edition.other_content || []).flatMap((item) => {
    if (!failedValues.has(item.body)) return [item];
    const printedText = (item.title || "").trim();
    if (!printedText || printedText === "Unidentified image") return [];
    return [{ ...item, body: "" }];
  });
}

function replaceReferences(edition, replacements) {
  const replaceOwner = (owner) => {
    if (!Array.isArray(owner.image_files)) return;
    owner.image_files = owner.image_files.map((value) => replacements.get(value) || value);
  };
  for (const article of edition.articles || []) replaceOwner(article);
  for (const ad of edition.ads || []) replaceOwner(ad);
  for (const ad of edition.enriched_ads || []) replaceOwner(ad);
  for (const item of edition.other_content || []) {
    if (replacements.has(item.body)) item.body = replacements.get(item.body);
  }
}

async function optimizeAsset(sharp, sourcePath) {
  const metadata = await sharp(sourcePath).metadata();
  if (!metadata.width || !metadata.height) throw new Error("image dimensions unavailable");
  const sourceBytes = readFileSync(sourcePath);
  const sourceHash = createHash("sha256").update(sourceBytes).digest("hex");
  if (
    extname(sourcePath).toLowerCase() === ".webp" &&
    basename(sourcePath) === `${sourceHash}.webp` &&
    sourceBytes.length < MAX_ASSET_BYTES &&
    Math.max(metadata.width, metadata.height) <= MAX_LONG_EDGE
  ) {
    return {
      buffer: sourceBytes,
      quality: null,
      targetLong: Math.max(metadata.width, metadata.height),
      width: metadata.width,
      height: metadata.height,
    };
  }
  const originalLong = Math.max(metadata.width, metadata.height);
  let targetLong = Math.min(originalLong, MAX_LONG_EDGE);
  const floor = Math.min(originalLong, DIMENSION_FLOOR);
  let last = null;

  while (targetLong >= floor) {
    for (const quality of QUALITY_STEPS) {
      const pipeline = sharp(sourcePath).rotate();
      const buffer = await pipeline
        .resize({
          width: metadata.width >= metadata.height ? Math.round(targetLong) : undefined,
          height: metadata.height > metadata.width ? Math.round(targetLong) : undefined,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality, effort: 6 })
        .toBuffer();
      last = { buffer, quality, targetLong };
      if (buffer.length < MAX_ASSET_BYTES) {
        const outputMeta = await sharp(buffer).metadata();
        return { ...last, width: outputMeta.width, height: outputMeta.height };
      }
    }
    if (targetLong === floor) break;
    targetLong = Math.max(floor, Math.floor(targetLong * 0.9));
  }
  throw new Error(
    `cannot satisfy ${MAX_ASSET_BYTES}-byte limit at quality ${last?.quality || 75} and ${last?.targetLong || targetLong}px`,
  );
}

const edition = JSON.parse(readFileSync(editionPath, "utf8"));
const references = collectReferences(edition);
const uniqueReferences = [...new Set(references.map((item) => item.value).filter(Boolean))].sort();

if (uniqueReferences.length === 0) {
  if (!dryRun) {
    if (existsSync(imagesDir)) {
      for (const filename of readdirSync(imagesDir)) unlinkSync(join(imagesDir, filename));
    }
    atomicJson(join(editionDir, "asset-manifest.json"), {
      schema_version: 1,
      date,
      assets: [],
      total_bytes: 0,
    });
  }
  console.log("No referenced images to optimize or upload.");
  process.exit(0);
}

loadEnvLocal();
if (!dryRun) {
  const required = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) {
    console.error(`ERROR: Missing R2 configuration: ${missing.join(", ")}`);
    process.exit(2);
  }
}

const sharp = (await import("sharp")).default;
let s3 = null;
let commands = null;
if (!dryRun) {
  const sdk = await import("@aws-sdk/client-s3");
  commands = sdk;
  s3 = new sdk.S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
}

mkdirSync(imagesDir, { recursive: true });
const replacements = new Map();
const failedValues = new Set();
const assetsByHash = new Map();

for (const reference of uniqueReferences) {
  const sourcePath = safeLocalImagePath(reference);
  if (!sourcePath || !existsSync(sourcePath)) {
    console.error(`PRUNE ${reference}: source file is missing or unsafe`);
    failedValues.add(reference);
    continue;
  }
  try {
    const optimized = await optimizeAsset(sharp, sourcePath);
    const hash = createHash("sha256").update(optimized.buffer).digest("hex");
    const publicPath = `images/${hash}.webp`;
    const outputPath = join(editionDir, publicPath);
    const key = `ocr-assets/${hash}.webp`;
    replacements.set(reference, publicPath);

    if (!assetsByHash.has(hash)) {
      let uploadStatus = dryRun ? "dry_run" : "uploaded";
      if (!dryRun) {
        const partial = `${outputPath}.part`;
        writeFileSync(partial, optimized.buffer);
        renameSync(partial, outputPath);
        try {
          if (!values.force) {
            await s3.send(new commands.HeadObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key }));
            uploadStatus = "existing";
          } else {
            throw Object.assign(new Error("forced upload"), { name: "NotFound" });
          }
        } catch (error) {
          if (error.name !== "NotFound" && error.$metadata?.httpStatusCode !== 404) throw error;
          await s3.send(new commands.PutObjectCommand({
            Bucket: process.env.R2_BUCKET_NAME,
            Key: key,
            Body: optimized.buffer,
            ContentType: "image/webp",
            CacheControl: "public, max-age=31536000, immutable",
          }));
        }
      }
      assetsByHash.set(hash, {
        hash,
        public_path: publicPath,
        r2_key: key,
        size_bytes: optimized.buffer.length,
        width: optimized.width,
        height: optimized.height,
        quality: optimized.quality,
        status: uploadStatus,
      });
    }
    console.log(
      `${dryRun ? "PLAN" : "OK"} ${basename(sourcePath)} -> ${publicPath} ` +
      `(${optimized.buffer.length} bytes, ${optimized.width}x${optimized.height})`,
    );
  } catch (error) {
    console.error(`PRUNE ${reference}: ${error.message}`);
    failedValues.add(reference);
  }
}

for (const failed of failedValues) replacements.delete(failed);
removeFailedReferences(edition, failedValues);
replaceReferences(edition, replacements);

const referencedHashes = new Set(
  collectReferences(edition)
    .map((item) => /^images\/([a-f0-9]{64})\.webp$/.exec(item.value)?.[1])
    .filter(Boolean),
);
const assets = [...assetsByHash.values()].filter((asset) => referencedHashes.has(asset.hash));
const totalBytes = assets.reduce((sum, asset) => sum + asset.size_bytes, 0);

if (totalBytes > MAX_EDITION_BYTES) {
  console.error(`ERROR: optimized public assets total ${(totalBytes / 1048576).toFixed(1)} MiB; limit is 25 MiB`);
  process.exit(3);
}
if (totalBytes > WARN_EDITION_BYTES) {
  console.warn(`WARNING: optimized public assets total ${(totalBytes / 1048576).toFixed(1)} MiB`);
}

if (!dryRun) {
  const keep = new Set(assets.map((asset) => basename(asset.public_path)));
  for (const filename of readdirSync(imagesDir)) {
    if (!keep.has(filename)) unlinkSync(join(imagesDir, filename));
  }
  atomicJson(editionPath, edition);
  atomicJson(join(editionDir, "asset-manifest.json"), {
    schema_version: 1,
    date,
    total_bytes: totalBytes,
    assets,
  });
}

console.log(`${dryRun ? "Would retain" : "Retained"} ${assets.length} content-addressed asset(s); pruned ${failedValues.size} failed reference(s).`);
