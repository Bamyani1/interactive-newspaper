#!/usr/bin/env node
/**
 * One-off migration: create the ask_feedback table + indexes.
 *
 * Run with:
 *   node scripts/db/migrate-ask-feedback.mjs
 *
 * Idempotent: every statement uses IF NOT EXISTS. Safe to re-run.
 *
 * Loads DATABASE_URL from .env.local with the same hand-rolled parser
 * that seed.mjs uses (no dotenv dependency).
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
  console.log("Creating ask_feedback table...");
  await sql`
    CREATE TABLE IF NOT EXISTS ask_feedback (
      id          BIGSERIAL PRIMARY KEY,
      request_id  TEXT NOT NULL,
      question    TEXT NOT NULL,
      answer      TEXT NOT NULL,
      confidence  TEXT,
      mode        TEXT,
      citations   JSONB NOT NULL DEFAULT '[]',
      vote        TEXT NOT NULL CHECK (vote IN ('up', 'down')),
      comment     TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  console.log("Creating idx_ask_feedback_request...");
  await sql`CREATE INDEX IF NOT EXISTS idx_ask_feedback_request ON ask_feedback(request_id)`;

  console.log("Creating idx_ask_feedback_created...");
  await sql`CREATE INDEX IF NOT EXISTS idx_ask_feedback_created ON ask_feedback(created_at DESC)`;

  const rows = await sql`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'ask_feedback'
    ORDER BY ordinal_position
  `;
  console.log("\nask_feedback columns:");
  for (const row of rows) {
    console.log(`  ${row.column_name.padEnd(14)} ${row.data_type}`);
  }

  console.log("\nMigration complete.");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
