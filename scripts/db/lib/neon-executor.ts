import { neon, neonConfig } from "@neondatabase/serverless";
import type { QueryExecutor, SqlStatement } from "./migration-runner";

// Local eval bridge: when NEON_HTTP_SHIM_URL is set, the driver's HTTP queries
// go to the local shim (scripts/db/lib/neon-http-shim.mjs) instead of
// *.neon.tech. The shim refuses any connection string whose host is not its
// local marker, so production URLs cannot be routed through it by accident.
const shimUrl = process.env.NEON_HTTP_SHIM_URL?.trim();
if (shimUrl) {
    neonConfig.fetchEndpoint = shimUrl;
}

/**
 * Production executor over the Neon HTTP driver. transactionBatch() submits
 * every statement as one non-interactive Postgres transaction in a single
 * HTTP request — the same mechanism seed.mjs already uses — so a leading
 * pg_advisory_xact_lock statement is held until the batch commits.
 */
export function createNeonExecutor(databaseUrl: string): QueryExecutor {
    const sql = neon(databaseUrl);
    return {
        async query(stmt: SqlStatement): Promise<Record<string, unknown>[]> {
            const rows = await sql.query(stmt.text, stmt.params ?? []);
            return rows as Record<string, unknown>[];
        },
        async transactionBatch(stmts: SqlStatement[]): Promise<void> {
            await sql.transaction(stmts.map((stmt) => sql.query(stmt.text, stmt.params ?? [])));
        },
    };
}
