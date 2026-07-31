#!/usr/bin/env node

/** Manifest-aware R2 lifecycle cleanup. Dry-run unless --apply is supplied. */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    apply: { type: "boolean", default: false },
    "editions-dir": { type: "string" },
    "grace-days": { type: "string", default: "30" },
  },
  strict: true,
});
const graceDays = Number.parseInt(values["grace-days"], 10);
if (!Number.isFinite(graceDays) || graceDays < 30) {
  throw new Error("--grace-days must be an integer of at least 30");
}

const root = resolve(import.meta.dirname, "../..");
const editionsDir = resolve(values["editions-dir"] || join(root, "public/editions"));
const assetLockParent = join(root, "public/editions/.locks");
const assetLockDir = join(assetLockParent, "assets.lock");
mkdirSync(assetLockParent, { recursive: true });
try {
  mkdirSync(assetLockDir);
} catch (error) {
  if (error?.code === "EEXIST") {
    throw new Error("OCR asset publication or another R2 GC run is active");
  }
  throw error;
}
let assetLockHeld = true;
const releaseAssetLock = () => {
  if (!assetLockHeld) return;
  assetLockHeld = false;
  try {
    rmdirSync(assetLockDir);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
};
process.on("exit", releaseAssetLock);

const referenced = new Set();
if (!existsSync(editionsDir)) {
  throw new Error(`Public editions directory does not exist: ${editionsDir}`);
}
let publicEditionCount = 0;
for (const entry of readdirSync(editionsDir, { withFileTypes: true })) {
  if (!entry.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(entry.name)) continue;
  publicEditionCount += 1;
  const manifestPath = join(editionsDir, entry.name, "asset-manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`Refusing R2 GC: public edition ${entry.name} has no asset manifest`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!Array.isArray(manifest.assets)) {
    throw new Error(`Refusing R2 GC: invalid asset manifest for ${entry.name}`);
  }
  for (const asset of manifest.assets) {
    if (typeof asset.r2_key !== "string" || !/^ocr-assets\/[a-f0-9]{64}\.webp$/.test(asset.r2_key)) {
      throw new Error(`Refusing R2 GC: invalid R2 key in ${entry.name}`);
    }
    referenced.add(asset.r2_key);
  }
}
if (publicEditionCount === 0) {
  throw new Error("Refusing R2 GC: no public edition manifests were found");
}

const envPath = join(root, ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const at = trimmed.indexOf("=");
    if (at < 1) continue;
    const name = trimmed.slice(0, at);
    const value = trimmed.slice(at + 1).replace(/^["']|["']$/g, "");
    if (!process.env[name]) process.env[name] = value;
  }
}

const required = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) throw new Error(`Missing R2 configuration: ${missing.join(", ")}`);

const {
  S3Client,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} = await import("@aws-sdk/client-s3");
const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const gcStateKey = "ocr-assets-gc/unreferenced.json";
let previousState = { schema_version: 1, unreferenced_since: {} };
try {
  const response = await s3.send(new GetObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: gcStateKey,
  }));
  const parsed = JSON.parse(await response.Body.transformToString());
  if (parsed && typeof parsed.unreferenced_since === "object") previousState = parsed;
} catch (error) {
  if (error.name !== "NoSuchKey" && error.name !== "NotFound" && error.$metadata?.httpStatusCode !== 404) {
    throw error;
  }
}

const cutoff = Date.now() - graceDays * 24 * 60 * 60 * 1000;
const stale = [];
const newlyUnreferenced = [];
const nextUnreferenced = {};
let ignoredObjectCount = 0;
let continuationToken;
do {
  const page = await s3.send(new ListObjectsV2Command({
    Bucket: process.env.R2_BUCKET_NAME,
    Prefix: "ocr-assets/",
    ContinuationToken: continuationToken,
  }));
  for (const object of page.Contents || []) {
    if (!object.Key || !/^ocr-assets\/[a-f0-9]{64}\.webp$/.test(object.Key)) {
      ignoredObjectCount += 1;
      continue;
    }
    if (referenced.has(object.Key)) continue;
    const prior = Number(previousState.unreferenced_since?.[object.Key]);
    const unreferencedSince = Number.isFinite(prior) && prior > 0 ? prior : Date.now();
    nextUnreferenced[object.Key] = unreferencedSince;
    if (!(Number.isFinite(prior) && prior > 0)) newlyUnreferenced.push(object.Key);
    if (unreferencedSince <= cutoff) stale.push(object.Key);
  }
  continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
} while (continuationToken);

for (const key of newlyUnreferenced) console.log(`${values.apply ? "MARK" : "WOULD_MARK"} ${key}`);
for (const key of stale) console.log(`${values.apply ? "DELETE" : "STALE"} ${key}`);
if (values.apply) {
  for (let index = 0; index < stale.length; index += 1000) {
    const batch = stale.slice(index, index + 1000);
    const deleted = await s3.send(new DeleteObjectsCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
    }));
    const failed = new Set((deleted.Errors || []).map((item) => item.Key).filter(Boolean));
    for (const key of batch) {
      if (!failed.has(key)) delete nextUnreferenced[key];
    }
    if (failed.size) {
      throw new Error(`R2 refused to delete ${failed.size} stale object(s)`);
    }
  }
  await s3.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: gcStateKey,
    Body: `${JSON.stringify({
      schema_version: 1,
      updated_at: new Date().toISOString(),
      unreferenced_since: nextUnreferenced,
    }, null, 2)}\n`,
    ContentType: "application/json",
    CacheControl: "no-store",
  }));
}
releaseAssetLock();
console.log(`${values.apply ? "Deleted" : "Would delete"} ${stale.length} globally unreferenced object(s); ${referenced.size} current object(s) protected; ${ignoredObjectCount} non-asset key(s) ignored.`);
