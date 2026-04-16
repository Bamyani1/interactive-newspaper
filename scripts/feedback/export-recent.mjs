#!/usr/bin/env node
/**
 * Export recent thumb-down feedback (with comments + session_id) as CSV
 * on stdout so operators can scan it, filter, or paste into a sheet.
 *
 * Usage:
 *   node scripts/feedback/export-recent.mjs            # last 7 days, thumbs-down only
 *   node scripts/feedback/export-recent.mjs --days 30  # last 30 days
 *   node scripts/feedback/export-recent.mjs --vote up  # only thumbs-up
 *   node scripts/feedback/export-recent.mjs --vote any # both
 *
 * Loads DATABASE_URL from .env.local using the same parser the other
 * scripts use (no dotenv dependency).
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

function parseArgs(argv) {
  const args = { days: 7, vote: "down" };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--days" && argv[i + 1]) {
      args.days = Number(argv[++i]) || 7;
    } else if (arg === "--vote" && argv[i + 1]) {
      args.vote = String(argv[++i]);
    } else if (arg === "-h" || arg === "--help") {
      console.error(
        "Usage: node scripts/feedback/export-recent.mjs [--days N] [--vote up|down|any]",
      );
      process.exit(0);
    }
  }
  if (!["up", "down", "any"].includes(args.vote)) {
    console.error(`Invalid --vote value '${args.vote}'. Expected up, down, or any.`);
    process.exit(1);
  }
  return args;
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  // Quote if it contains ", comma, newline, or carriage return
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

async function main() {
  const args = parseArgs(process.argv);
  const sql = neon(process.env.DATABASE_URL);

  const cutoffIso = new Date(Date.now() - args.days * 24 * 60 * 60 * 1000)
    .toISOString();

  const rows =
    args.vote === "any"
      ? await sql`
          SELECT id, created_at, request_id, session_id, vote, confidence, mode,
                 question, answer, comment
          FROM ask_feedback
          WHERE created_at >= ${cutoffIso}
          ORDER BY created_at DESC
        `
      : await sql`
          SELECT id, created_at, request_id, session_id, vote, confidence, mode,
                 question, answer, comment
          FROM ask_feedback
          WHERE created_at >= ${cutoffIso}
            AND vote = ${args.vote}
          ORDER BY created_at DESC
        `;

  const headers = [
    "id",
    "created_at",
    "request_id",
    "session_id",
    "vote",
    "confidence",
    "mode",
    "question",
    "answer",
    "comment",
  ];
  process.stdout.write(headers.join(",") + "\n");
  for (const row of rows) {
    const line = headers.map((h) => csvEscape(row[h])).join(",");
    process.stdout.write(line + "\n");
  }

  console.error(
    `[export-recent] wrote ${rows.length} rows (last ${args.days} days, vote=${args.vote})`,
  );
}

main().catch((err) => {
  console.error("Export failed:", err);
  process.exit(1);
});
