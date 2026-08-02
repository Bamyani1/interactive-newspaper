#!/usr/bin/env node
/**
 * One-off migration: create ask_session_turns for the Neon-backed
 * conversation store (src/lib/conversation-store.ts).
 *
 * Run with:
 *   node scripts/db/migrate-ask-sessions.mjs
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
  console.log("Creating ask_session_turns table...");
  await sql`
    CREATE TABLE IF NOT EXISTS ask_session_turns (
      id                 BIGSERIAL PRIMARY KEY,
      session_id         TEXT NOT NULL,
      question           TEXT NOT NULL,
      answer             TEXT NOT NULL,
      cited_article_ids  TEXT[] NOT NULL DEFAULT '{}',
      citation_snapshots JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    ALTER TABLE ask_session_turns
    ADD COLUMN IF NOT EXISTS citation_snapshots JSONB NOT NULL DEFAULT '[]'::jsonb
  `;
  console.log("Creating idx_ask_session_turns_session_created...");
  await sql`
    CREATE INDEX IF NOT EXISTS idx_ask_session_turns_session_created
    ON ask_session_turns(session_id, created_at DESC)
  `;
  console.log("Creating idx_ask_session_turns_created...");
  await sql`
    CREATE INDEX IF NOT EXISTS idx_ask_session_turns_created
    ON ask_session_turns(created_at DESC)
  `;

  const rows = await sql`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'ask_session_turns'
    ORDER BY ordinal_position
  `;
  console.log("\nask_session_turns columns:");
  for (const row of rows) {
    console.log(`  ${row.column_name.padEnd(20)} ${row.data_type}`);
  }

  console.log("\nMigration complete.");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
