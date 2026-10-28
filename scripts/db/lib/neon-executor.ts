import { createSql, describeDatabaseTarget } from "../../../src/lib/sql";
import { ensureLocalShim } from "./local-shim.mjs";
import type { QueryExecutor, SqlStatement } from "./migration-runner";

const announced = new Set<string>();

/**
 * Executor over the Neon HTTP driver. transactionBatch() submits every
 * statement as one non-interactive Postgres transaction in a single HTTP
 * request — the same mechanism seed.mjs already uses — so a leading
 * pg_advisory_xact_lock statement is held until the batch commits.
 *
 * A localhost URL is served by the local neon-http-shim, started on first
 * use; production stays on Neon. The target is printed once to stderr.
 */
export function createNeonExecutor(databaseUrl: string): QueryExecutor {
  const sql = createSql(databaseUrl);
  if (!announced.has(databaseUrl)) {
    announced.add(databaseUrl);
    console.error(`[db] target: ${describeDatabaseTarget(databaseUrl)}`);
  }
  let ready: Promise<void> | null = null;
  const ensureReady = () => (ready ??= ensureLocalShim(databaseUrl));
  return {
    async query(stmt: SqlStatement): Promise<Record<string, unknown>[]> {
      await ensureReady();
      const rows = await sql.query(stmt.text, stmt.params ?? []);
      return rows as Record<string, unknown>[];
    },
    async transactionBatch(stmts: SqlStatement[]): Promise<void> {
      await ensureReady();
      await sql.transaction(stmts.map((stmt) => sql.query(stmt.text, stmt.params ?? [])));
    },
  };
}
