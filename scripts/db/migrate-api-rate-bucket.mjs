#!/usr/bin/env node
/**
 * One-off migration: create the api_rate_bucket table used by
 * src/lib/rate-limit.ts for distributed rate limiting across
 * Vercel function instances.
 *
 * Run with:
 *   node scripts/db/migrate-api-rate-bucket.mjs
 *
 * Idempotent: IF NOT EXISTS. Safe to re-run.
 */

import { neon } from "@neondatabase/serverless";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, "../../.env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const match = line.match(/^\s*([^#=]+?)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}

if (!process.env.DATABASE_URL) {
  console.error(`ERROR: DATABASE_URL not set. Expected it in ${envPath}.`);
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

async function main() {
  console.log("Creating api_rate_bucket table...");
  await sql`
    CREATE TABLE IF NOT EXISTS api_rate_bucket (
      key         TEXT PRIMARY KEY,
      count       INTEGER NOT NULL DEFAULT 0,
      expires_at  TIMESTAMPTZ NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  console.log("Creating idx_api_rate_bucket_expires...");
  await sql`
    CREATE INDEX IF NOT EXISTS idx_api_rate_bucket_expires
    ON api_rate_bucket(expires_at)
  `;

  const rows = await sql`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'api_rate_bucket'
    ORDER BY ordinal_position
  `;
  console.log("\napi_rate_bucket columns:");
  for (const row of rows) {
    console.log(`  ${row.column_name.padEnd(14)} ${row.data_type}`);
  }

  console.log("\nMigration complete.");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
