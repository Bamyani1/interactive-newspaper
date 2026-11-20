// The local-only `ops` schema: run tracking for archive:sync / archive:run.
// It never exists in Neon, and db:pull replaces only `public`, so it survives
// a pull. Idempotent DDL, run by the archive commands themselves.

import type { QueryExecutor } from "../../db/lib/migration-runner";
import { SOURCE_STATUSES } from "./source-editions";

const statusList = SOURCE_STATUSES.map((status) => `'${status}'`).join(", ");

export const OPS_SCHEMA_SQL = [
  "CREATE SCHEMA IF NOT EXISTS ops",
  `CREATE TABLE IF NOT EXISTS ops.source_editions (
    pointer integer PRIMARY KEY,
    edition_date text NOT NULL CHECK (edition_date ~ '^\\d{4}-\\d{2}-\\d{2}$'),
    title text NOT NULL,
    masthead text NOT NULL,
    page_count integer,
    status text NOT NULL CHECK (status IN (${statusList})),
    seeded_target text CHECK (seeded_target IN ('local', 'production')),
    local_dir text,
    attempts integer NOT NULL DEFAULT 0,
    last_error text,
    ocr_cost_usd numeric(10, 4),
    last_run_id text,
    first_seen_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  "CREATE INDEX IF NOT EXISTS source_editions_status_date ON ops.source_editions (status, edition_date)",
  `CREATE TABLE IF NOT EXISTS ops.run_lock (
    id smallint PRIMARY KEY CHECK (id = 1),
    run_id text NOT NULL,
    pid integer NOT NULL,
    started_at timestamptz NOT NULL DEFAULT now()
  )`,
];

export async function ensureOpsSchema(executor: QueryExecutor): Promise<void> {
  for (const text of OPS_SCHEMA_SQL) await executor.query({ text });
}
