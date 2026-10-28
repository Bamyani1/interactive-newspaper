#!/usr/bin/env node
// Fills ops.source_editions (local database only) from CONTENTdm, one row per
// edition record. Safe to re-run: new records are inserted, rows a run has
// touched keep their state, and untouched rows whose date was published
// elsewhere are promoted. Prints the exact counts.
//
// Usage: npm run archive:sync

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { createNeonExecutor } from "../db/lib/neon-executor";
import { DEFAULT_BASE_URL, DEFAULT_COLLECTION, fetchParentRecords } from "../iiif/inventory-source";
import { describeDatabaseTarget, isLocalDatabaseUrl } from "../../src/lib/sql";
import { ensureOpsSchema } from "./lib/ops-schema";
import { planSync, type SourceStatus } from "./lib/source-editions";

const INBOX = "ocr/inbox";
const INSERT_BATCH = 500;

function scanInbox(root: string) {
  const byPointer = new Map<number, string>();
  const byDate = new Map<string, string>();
  let entries: string[] = [];
  try {
    entries = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return { byPointer, byDate };
  }
  for (const name of entries) {
    const dir = path.join(root, name);
    const date = name.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
    if (date) byDate.set(date, dir);
    try {
      const meta = JSON.parse(readFileSync(path.join(dir, ".iiif-source.json"), "utf8"));
      const pointer = String(meta.manifest_url ?? "").match(/\/p15963coll9\/(\d+)\//)?.[1];
      if (pointer) byPointer.set(Number(pointer), dir);
    } catch {
      // Older downloads carry no metadata; the date match covers them.
    }
  }
  return { byPointer, byDate };
}

async function main() {
  loadEnvConfig(process.cwd(), true, { info() {}, error: console.error });
  const databaseUrl = process.env.DATABASE_URL ?? "";
  if (!isLocalDatabaseUrl(databaseUrl)) {
    throw new Error(
      `archive:sync keeps run state in the local database; DATABASE_URL is ${describeDatabaseTarget(databaseUrl)}.`
    );
  }
  const executor = createNeonExecutor(databaseUrl);
  await ensureOpsSchema(executor);

  const { records, total } = await fetchParentRecords(DEFAULT_BASE_URL, DEFAULT_COLLECTION);
  if (records.length !== total) {
    throw new Error(
      `CONTENTdm returned ${records.length} of ${total} records; not syncing a partial list.`
    );
  }

  const existingRows = await executor.query({
    text: "SELECT pointer, status FROM ops.source_editions",
  });
  const published = await executor.query({ text: "SELECT date FROM editions" });
  const buildId = process.env.RAG_ACTIVE_INDEX_BUILD_ID?.trim();
  const indexed = buildId
    ? await executor.query({
        text: `SELECT DISTINCT a.edition_date FROM article_chunks c
               JOIN articles a ON a.id = c.article_id WHERE c.index_build_id = $1`,
        params: [buildId],
      })
    : [];
  const inbox = scanInbox(INBOX);

  const plan = planSync({
    records: records.map((record) => ({
      pointer: Number(record.pointer ?? record.dmrecord),
      date: record.date,
      title: record.title,
    })),
    existing: new Map(
      existingRows.map((row) => [Number(row.pointer), { status: row.status as SourceStatus }])
    ),
    publishedDates: new Set(published.map((row) => String(row.date))),
    indexedDates: new Set(indexed.map((row) => String(row.edition_date))),
    inboxByPointer: inbox.byPointer,
    inboxByDate: inbox.byDate,
  });

  for (let start = 0; start < plan.inserts.length; start += INSERT_BATCH) {
    const batch = plan.inserts.slice(start, start + INSERT_BATCH);
    const params: unknown[] = [];
    const values = batch.map((row) => {
      const base = params.length;
      params.push(
        row.pointer,
        row.edition_date,
        row.title,
        row.masthead,
        row.status,
        row.local_dir,
        row.last_error
      );
      return `(${Array.from({ length: 7 }, (_, i) => `$${base + i + 1}`).join(", ")})`;
    });
    await executor.query({
      text: `INSERT INTO ops.source_editions
               (pointer, edition_date, title, masthead, status, local_dir, last_error)
             VALUES ${values.join(", ")}
             ON CONFLICT (pointer) DO NOTHING`,
      params,
    });
  }
  for (const promotion of plan.promotions) {
    await executor.query({
      text: `UPDATE ops.source_editions SET status = $2, updated_at = now()
             WHERE pointer = $1 AND status IN ('pending', 'downloaded')`,
      params: [promotion.pointer, promotion.status],
    });
  }

  const byStatus = await executor.query({
    text: "SELECT status, count(*)::int AS n FROM ops.source_editions GROUP BY status ORDER BY status",
  });
  const byDecade = await executor.query({
    text: `SELECT substr(edition_date, 1, 3) || '0s' AS decade,
                  count(*)::int AS total,
                  count(*) FILTER (WHERE status = 'pending')::int AS pending
           FROM ops.source_editions GROUP BY 1 ORDER BY 1`,
  });
  console.log(
    `[archive:sync] ${records.length} CONTENTdm records; ${plan.inserts.length} new, ${plan.promotions.length} promoted`
  );
  console.log(byStatus.map((row) => `  ${row.status}: ${row.n}`).join("\n"));
  console.log(
    byDecade.map((row) => `  ${row.decade}: ${row.total} (${row.pending} pending)`).join("\n")
  );
}

main().catch((error) => {
  console.error(`[archive:sync] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
