#!/usr/bin/env node
/**
 * One-off migration: add session_id column to ask_feedback so the
 * feedback endpoint can store the conversation the vote came from.
 *
 * Run with:
 *   node scripts/db/migrate-ask-feedback-session.mjs
 *
 * Idempotent: ADD COLUMN IF NOT EXISTS. Safe to re-run.
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
  console.log("Adding session_id column to ask_feedback...");
  await sql`
    ALTER TABLE ask_feedback
    ADD COLUMN IF NOT EXISTS session_id TEXT
  `;
  console.log("Creating idx_ask_feedback_session...");
  await sql`
    CREATE INDEX IF NOT EXISTS idx_ask_feedback_session
    ON ask_feedback(session_id)
  `;

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
