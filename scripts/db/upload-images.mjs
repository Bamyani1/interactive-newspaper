#!/usr/bin/env node

/**
 * upload-images.mjs — Upload edition images to Cloudflare R2 as optimized WebP.
 *
 * Reads JPEGs from public/editions/<date>/images/, converts to WebP via sharp,
 * and uploads to R2. Idempotent: skips files that already exist unless --force.
 *
 * Usage:
 *   node scripts/db/upload-images.mjs --date 1980-04-17
 *   node scripts/db/upload-images.mjs --date 1980-04-17 --dry-run
 *   node scripts/db/upload-images.mjs --date 1980-04-17 --force
 *
 * Environment variables (not needed for --dry-run):
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
 */

import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { parseArgs } from "node:util";

// ── CLI args ────────────────────────────────────────────────────

const { values } = parseArgs({
  options: {
    date: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    force: { type: "boolean", default: false },
    "editions-dir": { type: "string" },
  },
  strict: true,
});

const date = values.date;
const dryRun = values["dry-run"];
const force = values.force;

if (!date) {
  console.error("Usage: node scripts/db/upload-images.mjs --date <YYYY-MM-DD> [--dry-run] [--force]");
  process.exit(1);
}

const rootDir = join(import.meta.dirname, "../..");
const editionsDir = values["editions-dir"] || join(rootDir, "public/editions");
const imagesDir = join(editionsDir, date, "images");

if (!existsSync(imagesDir)) {
  console.error(`ERROR: Images directory not found: ${imagesDir}`);
  process.exit(1);
}

// ── Discover images ─────────────────────────────────────────────

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".tif", ".tiff"]);

const imageFiles = readdirSync(imagesDir)
  .filter((f) => IMAGE_EXTENSIONS.has(extname(f).toLowerCase()))
  .sort();

if (imageFiles.length === 0) {
  console.log("No images found to upload.");
  process.exit(0);
}

console.log(`Found ${imageFiles.length} images in ${imagesDir}`);

if (dryRun) {
  console.log("\n── Dry run (no uploads) ──────────────────────────────");
  for (const file of imageFiles) {
    const webpName = file.replace(/\.(jpe?g|png|gif|tiff?)$/i, ".webp");
    const key = `${date}/images/${webpName}`;
    console.log(`  ${file} → ${key}`);
  }
  console.log(`\nWould upload ${imageFiles.length} images as WebP.`);
  process.exit(0);
}

// ── Validate R2 env vars ────────────────────────────────────────

// Load .env.local if present
const envPath = join(rootDir, ".env.local");
if (existsSync(envPath)) {
  const { readFileSync } = await import("node:fs");
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx);
    let val = trimmed.slice(eqIdx + 1);
    // Strip surrounding quotes
    val = val.replace(/^["']|["']$/g, "");
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

const requiredVars = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"];
const missing = requiredVars.filter((v) => !process.env[v]);
if (missing.length > 0) {
  console.error(`ERROR: Missing environment variables: ${missing.join(", ")}`);
  console.error("Set these in .env.local or export them. Use --dry-run to skip upload.");
  process.exit(1);
}

// ── Initialize S3 client for R2 ─────────────────────────────────

const { S3Client, PutObjectCommand, HeadObjectCommand } = await import("@aws-sdk/client-s3");
const sharp = (await import("sharp")).default;

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const bucket = process.env.R2_BUCKET_NAME;

// ── Upload loop ─────────────────────────────────────────────────

const manifest = { date, uploaded: [], skipped: [], errors: [] };

for (const file of imageFiles) {
  const webpName = file.replace(/\.(jpe?g|png|gif|tiff?)$/i, ".webp");
  const key = `${date}/images/${webpName}`;
  const srcPath = join(imagesDir, file);

  // Check if already exists (skip unless --force)
  if (!force) {
    try {
      await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      console.log(`  SKIP ${file} (already exists)`);
      manifest.skipped.push(file);
      continue;
    } catch (err) {
      if (err.name !== "NotFound" && err.$metadata?.httpStatusCode !== 404) {
        console.error(`  ERROR checking ${file}: ${err.message}`);
        manifest.errors.push({ file, error: err.message });
        continue;
      }
      // 404 = doesn't exist, proceed with upload
    }
  }

  // Convert to WebP
  let webpBuffer;
  try {
    webpBuffer = await sharp(srcPath).webp({ quality: 85 }).toBuffer();
  } catch (err) {
    console.error(`  ERROR converting ${file}: ${err.message}`);
    manifest.errors.push({ file, error: `conversion: ${err.message}` });
    continue;
  }

  // Upload
  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: webpBuffer,
        ContentType: "image/webp",
        CacheControl: "public, max-age=31536000, immutable",
      })
    );
    const savings = ((1 - webpBuffer.length / (await import("node:fs")).statSync(srcPath).size) * 100).toFixed(0);
    console.log(`  ✓ ${file} → ${key} (${(webpBuffer.length / 1024).toFixed(0)}KB, ${savings}% smaller)`);
    manifest.uploaded.push({ file, key, size: webpBuffer.length });
  } catch (err) {
    console.error(`  ERROR uploading ${file}: ${err.message}`);
    manifest.errors.push({ file, error: `upload: ${err.message}` });
  }
}

// ── Write manifest ──────────────────────────────────────────────

const manifestPath = join(editionsDir, date, "upload-manifest.json");
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`\nManifest written to ${manifestPath}`);

// ── Summary ─────────────────────────────────────────────────────

console.log(`\n── Upload summary ──────────────────────────────────────`);
console.log(`  Uploaded: ${manifest.uploaded.length}`);
console.log(`  Skipped:  ${manifest.skipped.length}`);
console.log(`  Errors:   ${manifest.errors.length}`);

if (manifest.errors.length > 0) {
  process.exit(1);
}
