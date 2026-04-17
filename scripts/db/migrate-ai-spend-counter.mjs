#!/usr/bin/env node
/**
 * One-off migration: create the ai_spend_counter table (used by
 * src/lib/cost-tracker.ts for the daily budget kill switch).
 *
 * Run with:
 *   node scripts/db/migrate-ai-spend-counter.mjs
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
  console.log("Creating ai_spend_counter table...");
  await sql`
    CREATE TABLE IF NOT EXISTS ai_spend_counter (
      day         DATE PRIMARY KEY,
      spent_usd   NUMERIC(12, 6) NOT NULL DEFAULT 0,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  const rows = await sql`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'ai_spend_counter'
    ORDER BY ordinal_position
  `;
  console.log("\nai_spend_counter columns:");
  for (const row of rows) {
    console.log(`  ${row.column_name.padEnd(14)} ${row.data_type}`);
  }

  console.log("\nMigration complete.");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
