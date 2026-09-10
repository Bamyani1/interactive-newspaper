/** @vitest-environment node */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertMigrationsCurrent,
  CANONICAL_TABLES,
  LEDGER_TABLE,
  runMigrations,
} from "../../scripts/db/lib/migration-runner";
import { createTestDb, type TestDb } from "./helpers/pglite";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const SEED_PATH = path.resolve(testDir, "../../scripts/db/seed.mjs");

const DDL_PATTERN =
  /CREATE TABLE|ALTER TABLE|CREATE INDEX|CREATE EXTENSION|DROP TABLE|CREATE TRIGGER|CREATE OR REPLACE FUNCTION/i;

describe("seed.mjs is data-only", () => {
  it("contains no DDL statements (TRUNCATE is allowed)", () => {
    const source = readFileSync(SEED_PATH, "utf8");
    expect(source).not.toMatch(DDL_PATTERN);
  });

  // Rows that belong to an index build are written by rag:index:build,
  // which records and validates what it embeds. Without these filters seed
  // filled in a pending build's chunks behind its back.
  it("embeds only chunks outside any index build", () => {
    const source = readFileSync(SEED_PATH, "utf8");
    const selects = source.match(/SELECT c\.id, c\.chunk_index[\s\S]*?ORDER BY c\.id/g) ?? [];
    expect(selects).toHaveLength(2);
    for (const select of selects) expect(select).toContain("c.index_build_id IS NULL");
    const updates = source.match(/UPDATE article_chunks[\s\S]*?`/g) ?? [];
    expect(updates).toHaveLength(1);
    expect(updates[0]).toContain("AND index_build_id IS NULL");
  });
});

describe("canonical table registry and migration preflight", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
  }, 30000);

  afterAll(async () => {
    await db.close();
  });

  it("assertMigrationsCurrent rejects an unmigrated database, then resolves once migrated", async () => {
    await expect(assertMigrationsCurrent(db.executor)).rejects.toThrow(/npm run db:migrate/);
    await runMigrations(db.executor);
    await expect(assertMigrationsCurrent(db.executor)).resolves.toBeUndefined();
  });

  it("migrations create exactly the registered tables plus the ledger", async () => {
    // Idempotent; guarantees the shared db is migrated even if the
    // previous test is ever skipped or reordered.
    await runMigrations(db.executor);
    const result = await db.pg.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`
    );
    const actual = result.rows.map((row) => row.tablename).sort();
    const expected = [...CANONICAL_TABLES.map((t) => t.name), LEDGER_TABLE].sort();
    expect(actual).toEqual(expected);
  });
});
