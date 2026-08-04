import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import type { QueryExecutor, SqlStatement } from "../../../scripts/db/lib/migration-runner";
import { splitSqlStatements } from "../../../scripts/db/lib/sql-statements";

// The DB test suite must be incapable of touching a real database.
delete process.env.DATABASE_URL;

const helperDir = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.resolve(helperDir, "../../../scripts/db/migrations");
export const FIXTURES_DIR = path.resolve(helperDir, "../fixtures");

export interface TestDb {
    pg: PGlite;
    executor: QueryExecutor;
    close(): Promise<void>;
}

export function createPgliteExecutor(pg: PGlite): QueryExecutor {
    return {
        async query(stmt: SqlStatement): Promise<Record<string, unknown>[]> {
            const result = await pg.query(stmt.text, stmt.params ?? []);
            return result.rows as Record<string, unknown>[];
        },
        async transactionBatch(stmts: SqlStatement[]): Promise<void> {
            await pg.transaction(async (tx) => {
                for (const stmt of stmts) {
                    await tx.query(stmt.text, stmt.params ?? []);
                }
            });
        },
    };
}

export async function createTestDb(): Promise<TestDb> {
    const pg = new PGlite({ extensions: { vector } });
    await pg.waitReady;
    return {
        pg,
        executor: createPgliteExecutor(pg),
        close: () => pg.close(),
    };
}

/** Applies a legacy-shape fixture (e.g. the frozen production baseline). */
export async function applyFixture(pg: PGlite, fixtureFileName: string): Promise<void> {
    const raw = readFileSync(path.join(FIXTURES_DIR, fixtureFileName), "utf8");
    for (const stmt of splitSqlStatements(raw)) {
        await pg.exec(stmt);
    }
}

export interface SchemaSnapshot {
    tables: Record<
        string,
        {
            columns: Array<{
                name: string;
                dataType: string;
                nullable: boolean;
                default: string | null;
            }>;
            constraints: string[];
        }
    >;
    indexes: Record<string, string>;
    triggers: Record<string, string>;
    functions: Record<string, string>;
    extensions: string[];
}

/**
 * Deterministic catalog dump for fresh-vs-upgraded schema equality. Columns
 * are sorted by name because upgrade-path ALTER..ADD COLUMN appends columns
 * in a different ordinal order than a fresh CREATE TABLE.
 */
export async function introspectSchema(pg: PGlite): Promise<SchemaSnapshot> {
    const tablesResult = await pg.query<{ tablename: string }>(
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    );

    const tables: SchemaSnapshot["tables"] = {};
    for (const { tablename } of tablesResult.rows) {
        const columns = await pg.query<{
            column_name: string;
            data_type: string;
            is_nullable: string;
            column_default: string | null;
            udt_name: string;
        }>(
            `SELECT column_name, data_type, is_nullable, column_default, udt_name
             FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = $1
             ORDER BY column_name`,
            [tablename],
        );
        // contype 'n' (NOT NULL) rows exist only on Postgres 18+ (PGlite);
        // nullability is captured per-column above, so exclude them to keep
        // snapshots comparable with a Postgres 17 server (Neon).
        const constraints = await pg.query<{ def: string }>(
            `SELECT conname || ' ' || pg_get_constraintdef(oid) AS def
             FROM pg_constraint
             WHERE conrelid = $1::regclass AND contype <> 'n'
             ORDER BY conname`,
            [tablename],
        );
        tables[tablename] = {
            columns: columns.rows.map((col) => ({
                name: col.column_name,
                dataType: col.data_type === "USER-DEFINED" ? col.udt_name : col.data_type,
                nullable: col.is_nullable === "YES",
                default: col.column_default,
            })),
            constraints: constraints.rows.map((row) => row.def),
        };
    }

    const indexes = await pg.query<{ indexname: string; indexdef: string }>(
        `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname`,
    );
    const triggers = await pg.query<{ tgname: string; def: string }>(
        `SELECT t.tgname, pg_get_triggerdef(t.oid) AS def
         FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND NOT t.tgisinternal
         ORDER BY t.tgname`,
    );
    // prokind = 'f' and the pg_depend filter exclude extension-owned functions
    // and aggregates (pg_get_functiondef raises on pgvector's aggregates).
    const functions = await pg.query<{ proname: string; def: string }>(
        `SELECT p.proname, pg_get_functiondef(p.oid) AS def
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.prokind = 'f'
           AND NOT EXISTS (
             SELECT 1 FROM pg_depend d
             WHERE d.classid = 'pg_proc'::regclass
               AND d.objid = p.oid
               AND d.deptype = 'e'
           )
         ORDER BY p.proname`,
    );
    const extensions = await pg.query<{ extname: string }>(
        `SELECT extname FROM pg_extension ORDER BY extname`,
    );

    return {
        tables,
        indexes: Object.fromEntries(indexes.rows.map((row) => [row.indexname, row.indexdef])),
        triggers: Object.fromEntries(triggers.rows.map((row) => [row.tgname, row.def])),
        functions: Object.fromEntries(functions.rows.map((row) => [row.proname, row.def])),
        extensions: extensions.rows.map((row) => row.extname),
    };
}
