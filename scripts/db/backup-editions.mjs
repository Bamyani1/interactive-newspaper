#!/usr/bin/env node
/**
 * Back up each edition's OCR output (edition.json and its manifests) to R2
 * under `edition-backups/<date>/`, or restore missing files from there.
 *
 * public/editions/ is gitignored and lives only on the machine that ran OCR,
 * yet `db:seed` rebuilds the database from it. Images are already in R2 under
 * `ocr-assets/`; this covers the JSON. gc-r2-assets.mjs never collects these
 * keys (it only matches `ocr-assets/<sha>.webp` and `<date>/images/<name>`).
 *
 *   npm run editions:backup               # upload new or changed files
 *   npm run editions:backup -- --dry-run  # report what would upload
 *   npm run editions:backup -- --restore  # download files missing locally
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const PREFIX = "edition-backups/";
const BACKED_UP_FILES = [
  "edition.json",
  "asset-manifest.json",
  "upload-manifest.json",
  "provenance.json",
];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const md5 = (body) => createHash("md5").update(body).digest("hex");

/**
 * @param {{ editionsDir: string, client: { head: (key: string) => Promise<{ etag: string } | null>, put: (key: string, body: Buffer) => Promise<void> }, dryRun?: boolean, log?: (message: string) => void }} options
 */
export async function backupEditions({ editionsDir, client, dryRun = false, log = console.log }) {
  let uploaded = 0;
  let unchanged = 0;
  for (const date of readdirSync(editionsDir).filter((name) => DATE_PATTERN.test(name)).sort()) {
    for (const file of BACKED_UP_FILES) {
      const localPath = path.join(editionsDir, date, file);
      if (!existsSync(localPath)) continue;
      const body = readFileSync(localPath);
      const key = `${PREFIX}${date}/${file}`;
      const stored = await client.head(key);
      if (stored?.etag === md5(body)) {
        unchanged += 1;
        continue;
      }
      if (!dryRun) await client.put(key, body);
      log(`${dryRun ? "WOULD_UPLOAD" : "UPLOADED"} ${key}`);
      uploaded += 1;
    }
  }
  return { uploaded, unchanged };
}

/**
 * @param {{ editionsDir: string, client: { list: (prefix: string) => Promise<string[]>, get: (key: string) => Promise<Buffer | null> }, log?: (message: string) => void }} options
 */
export async function restoreEditions({ editionsDir, client, log = console.log }) {
  let restored = 0;
  let kept = 0;
  for (const key of await client.list(PREFIX)) {
    const [date, file, ...rest] = key.slice(PREFIX.length).split("/");
    if (!DATE_PATTERN.test(date) || !BACKED_UP_FILES.includes(file) || rest.length > 0) continue;
    const localPath = path.join(editionsDir, date, file);
    if (existsSync(localPath)) {
      kept += 1;
      continue;
    }
    const body = await client.get(key);
    if (!body) continue;
    mkdirSync(path.dirname(localPath), { recursive: true });
    writeFileSync(`${localPath}.part`, body);
    renameSync(`${localPath}.part`, localPath);
    log(`RESTORED ${date}/${file}`);
    restored += 1;
  }
  return { restored, kept };
}

function loadEnvLocal(rootDir) {
  const envPath = path.join(rootDir, ".env.local");
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

async function r2Client() {
  const sdk = await import("@aws-sdk/client-s3");
  const s3 = new sdk.S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
  const Bucket = process.env.R2_BUCKET_NAME;
  return {
    async head(key) {
      try {
        const result = await s3.send(new sdk.HeadObjectCommand({ Bucket, Key: key }));
        return { etag: String(result.ETag ?? "").replaceAll('"', "") };
      } catch (error) {
        if (error?.$metadata?.httpStatusCode === 404) return null;
        throw error;
      }
    },
    async put(key, body) {
      await s3.send(
        new sdk.PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: "application/json" })
      );
    },
    async list(prefix) {
      const keys = [];
      let ContinuationToken;
      do {
        const page = await s3.send(
          new sdk.ListObjectsV2Command({ Bucket, Prefix: prefix, ContinuationToken })
        );
        for (const object of page.Contents ?? []) keys.push(object.Key);
        ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (ContinuationToken);
      return keys;
    },
    async get(key) {
      const result = await s3.send(new sdk.GetObjectCommand({ Bucket, Key: key }));
      return result.Body ? Buffer.from(await result.Body.transformToByteArray()) : null;
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: { "dry-run": { type: "boolean" }, restore: { type: "boolean" } },
  });
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const editionsDir = path.join(rootDir, "public/editions");
  loadEnvLocal(rootDir);
  const required = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) {
    console.error(`ERROR: Missing R2 configuration: ${missing.join(", ")}`);
    process.exit(2);
  }
  const client = await r2Client();
  const result = values.restore
    ? await restoreEditions({ editionsDir, client })
    : await backupEditions({ editionsDir, client, dryRun: values["dry-run"] });
  console.log(JSON.stringify(result));
}
