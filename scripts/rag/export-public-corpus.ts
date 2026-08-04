/**
 * Public-corpus allowlist exporter (Phase 7 evaluation-environment proof).
 *
 * Exports EXACTLY the tables in PUBLIC_EXPORT_ALLOWLIST as one JSONL file per
 * table plus a self-hashed manifest.json, so a Neon evaluation database can be
 * populated from the artifact and the artifact itself proves no private data
 * was copied. Everything outside the allowlist is private by default: the
 * table-export internal hard-fails on any other table name, and this module
 * never reads ask_session_turns, ask_feedback, api_rate_bucket,
 * ai_spend_counter, or the schema_migrations ledger.
 *
 * Documented decisions:
 * - Excluded columns: articles.search_vector only. It is a derived tsvector
 *   maintained by the articles_search_vector_trig trigger, its binary form
 *   does not round-trip through JSONL, and the trigger regenerates it on
 *   import. articles.embedding IS exported: pgvector's text form round-trips
 *   cleanly and embeddings are derived from public article text.
 * - Schema provenance: the manifest records migration ids + checksums read
 *   from the ON-DISK migration files (discoverMigrations), never from the
 *   schema_migrations ledger, so the exporter performs zero reads of the
 *   ledger while still pinning the schema the corpus was exported under.
 * - JSON values: jsonb columns come back from drivers as parsed objects and
 *   are re-serialized with JSON.stringify on import. No allowlisted table has
 *   a Postgres array column (arrays would need `{...}` literals, not JSON).
 * - ads.id is SERIAL; after importing explicit ids the sequence is advanced
 *   past MAX(id) so later inserts cannot collide.
 *
 * Usage (requires DATABASE_URL and --yes; export is read-only against the DB):
 *   node --import tsx scripts/rag/export-public-corpus.ts --export <dir> --yes
 *   node --import tsx scripts/rag/export-public-corpus.ts --import <dir> --yes
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
    assertMigrationsCurrent,
    defaultMigrationsDir,
    discoverMigrations,
    type QueryExecutor,
} from "../db/lib/migration-runner";
import { createNeonExecutor } from "../db/lib/neon-executor";
import { loadLocalEnv } from "../lib/local-env";
import { stableStringify } from "./snapshot-corpus";
import { fileSha256 } from "./verify-evaluation-freeze";

type Row = Record<string, unknown>;

/**
 * The ONLY tables the exporter may read. Listed in FK-safe import order
 * (editions before articles/ads, which reference editions(date)).
 */
export const PUBLIC_EXPORT_ALLOWLIST = Object.freeze([
    "editions",
    "articles",
    "ads",
    "weather",
    "music",
] as const);

export type PublicTable = (typeof PUBLIC_EXPORT_ALLOWLIST)[number];

/**
 * Tables the manifest affirmatively lists as excluded. Every table outside
 * PUBLIC_EXPORT_ALLOWLIST is excluded by default; these are the ones that
 * hold user/privacy/operational state and must be provably absent.
 */
export const PRIVATE_TABLES: ReadonlyArray<{ name: string; reason: string }> = Object.freeze([
    {
        name: "ai_spend_counter",
        reason: "Operational AI spend accounting; never read by this exporter.",
    },
    {
        name: "api_rate_bucket",
        reason: "Rate-limit state keyed by client identity; never read by this exporter.",
    },
    {
        name: "ask_feedback",
        reason: "User-submitted feedback (questions, answers, comments); never read by this exporter.",
    },
    {
        name: "ask_session_turns",
        reason: "User conversation state (session ids, questions, answers); never read by this exporter.",
    },
    {
        name: "schema_migrations",
        reason:
            "Migration ledger; its contents are never read. The manifest's schemaProvenance " +
            "carries migration ids + checksums taken from the on-disk migration files instead.",
    },
]);

/** Explicit primary key per allowlisted table, for deterministic row order. */
export const TABLE_PRIMARY_KEYS: Readonly<Record<PublicTable, readonly string[]>> = Object.freeze({
    editions: ["date"],
    articles: ["id"],
    ads: ["id"],
    weather: ["date", "scope"],
    music: ["year", "month", "rank"],
});

/** Volatile/derived columns dropped from the export, each with its reason. */
export const EXCLUDED_COLUMNS: ReadonlyArray<{
    table: PublicTable;
    column: string;
    reason: string;
}> = Object.freeze([
    {
        table: "articles",
        column: "search_vector",
        reason:
            "Derived tsvector maintained by articles_search_vector_trig; it does not " +
            "round-trip through JSONL and the trigger regenerates it on import.",
    },
    {
        table: "articles",
        column: "embedding",
        reason:
            "Legacy article vectors are gemini-embedding-2-preview or unlabeled; runtime " +
            "SQL excludes them, so production's effective retrieval is lexical-only and the " +
            "evaluation baseline matches it exactly without copying ~100 MB of inert vectors. " +
            "Candidate vectors are built fresh, build-scoped, in the evaluation environment.",
    },
    {
        table: "articles",
        column: "embedding_model",
        reason: "Identity metadata for the excluded legacy vector column.",
    },
    {
        table: "articles",
        column: "embedding_input_hash",
        reason: "Identity metadata for the excluded legacy vector column.",
    },
    {
        table: "articles",
        column: "embedding_input_version",
        reason: "Identity metadata for the excluded legacy vector column.",
    },
]);

export const MANIFEST_HASH_RECIPE =
    "sha256 hex digest of JSON.stringify(canonical, null, 2) where canonical is the manifest " +
    "with fields in the fixed order {schemaVersion, hashRecipe, generatedAt, tables, " +
    "excludedTables, excludedColumns, schemaProvenance, selfSha256}, generatedAt and " +
    "selfSha256 both replaced by null";

export interface CorpusManifestTable {
    name: string;
    rowCount: number;
    /** sha256 hex digest of the table's JSONL file bytes. */
    sha256: string;
}

export interface CorpusManifest {
    schemaVersion: number;
    hashRecipe: string;
    generatedAt: string | null;
    tables: CorpusManifestTable[];
    excludedTables: Array<{ name: string; reason: string }>;
    excludedColumns: Array<{ table: string; column: string; reason: string }>;
    schemaProvenance: {
        source: string;
        migrations: Array<{ id: string; checksum: string }>;
    };
    selfSha256: string | null;
}

/**
 * Canonical JSON for self-hashing: fixed field order, volatile fields
 * (generatedAt, selfSha256) normalized to null — the same recipe style as
 * scripts/db/bootstrap-asset-registry.mjs.
 */
export function canonicalManifestJson(manifest: CorpusManifest): string {
    return JSON.stringify(
        {
            schemaVersion: manifest.schemaVersion,
            hashRecipe: manifest.hashRecipe,
            generatedAt: null,
            tables: manifest.tables,
            excludedTables: manifest.excludedTables,
            excludedColumns: manifest.excludedColumns,
            schemaProvenance: manifest.schemaProvenance,
            selfSha256: null,
        },
        null,
        2,
    );
}

export function manifestSelfSha256(manifest: CorpusManifest): string {
    return fileSha256(canonicalManifestJson(manifest));
}

/** Hard-fails on any table outside the frozen allowlist (private by default). */
export function assertAllowlisted(table: string): asserts table is PublicTable {
    if (!(PUBLIC_EXPORT_ALLOWLIST as readonly string[]).includes(table)) {
        throw new Error(
            `Table "${table}" is not in PUBLIC_EXPORT_ALLOWLIST ` +
                `(${PUBLIC_EXPORT_ALLOWLIST.join(", ")}); it is private by default and this ` +
                "exporter refuses to touch it.",
        );
    }
}

const IDENTIFIER_PATTERN = /^[a-z_][a-z0-9_]*$/;

function assertIdentifier(name: string): void {
    if (!IDENTIFIER_PATTERN.test(name)) {
        throw new Error(`Refusing to interpolate unsafe SQL identifier "${name}".`);
    }
}

/** Rows fetched per request; bounded so a wide table (articles bodies) stays
 * far under Neon's 64 MiB HTTP response cap. */
export const EXPORT_BATCH_SIZE = 2000;

/**
 * The table-export internal: reads ONE allowlisted table ordered by its
 * explicit primary key, with the documented excluded columns dropped. Reads
 * use keyset pagination (row-value comparison on the primary key) so no
 * single response exceeds the Neon HTTP driver's response-size cap.
 */
export async function exportTableRows(executor: QueryExecutor, table: string): Promise<Row[]> {
    assertAllowlisted(table);
    const pk = TABLE_PRIMARY_KEYS[table];
    for (const column of pk) assertIdentifier(column);
    const orderBy = pk.join(", ");
    const pkTuple = `(${pk.join(", ")})`;

    const rows: Row[] = [];
    let lastKey: unknown[] | null = null;
    for (;;) {
        const where = lastKey
            ? `WHERE ${pkTuple} > (${pk.map((_, i) => `$${i + 1}`).join(", ")})`
            : "";
        const batch = await executor.query({
            text: `SELECT * FROM ${table} ${where} ORDER BY ${orderBy} LIMIT ${EXPORT_BATCH_SIZE}`,
            params: lastKey ?? [],
        });
        rows.push(...batch);
        if (batch.length < EXPORT_BATCH_SIZE) break;
        const lastRow = batch[batch.length - 1];
        lastKey = pk.map((column) => lastRow[column]);
    }

    const excluded = new Set(
        EXCLUDED_COLUMNS.filter((entry) => entry.table === table).map((entry) => entry.column),
    );
    if (excluded.size === 0) return rows;
    return rows.map((row) =>
        Object.fromEntries(Object.entries(row).filter(([key]) => !excluded.has(key))),
    );
}

/** One row-object per line, stable key order, trailing newline per line. */
export function serializeTableJsonl(rows: Row[]): string {
    return rows.map((row) => `${stableStringify(row)}\n`).join("");
}

export interface ExportPublicCorpusResult {
    outDir: string;
    manifestPath: string;
    manifest: CorpusManifest;
}

export async function exportPublicCorpus(
    executor: QueryExecutor,
    options: { outDir: string; migrationsDir?: string },
): Promise<ExportPublicCorpusResult> {
    const outDir = path.resolve(options.outDir);
    mkdirSync(outDir, { recursive: true });

    const tables: CorpusManifestTable[] = [];
    for (const table of PUBLIC_EXPORT_ALLOWLIST) {
        const rows = await exportTableRows(executor, table);
        const jsonl = serializeTableJsonl(rows);
        writeFileSync(path.join(outDir, `${table}.jsonl`), jsonl, "utf8");
        tables.push({ name: table, rowCount: rows.length, sha256: fileSha256(jsonl) });
    }

    const migrations = discoverMigrations(options.migrationsDir ?? defaultMigrationsDir());
    const manifest: CorpusManifest = {
        schemaVersion: 1,
        hashRecipe: MANIFEST_HASH_RECIPE,
        generatedAt: null,
        tables,
        excludedTables: PRIVATE_TABLES.map((entry) => ({ ...entry })),
        excludedColumns: EXCLUDED_COLUMNS.map((entry) => ({ ...entry })),
        schemaProvenance: {
            source: "on-disk migration files (scripts/db/migrations); the schema_migrations ledger is never read",
            migrations: migrations.map((m) => ({ id: m.id, checksum: m.checksum })),
        },
        selfSha256: null,
    };
    manifest.selfSha256 = manifestSelfSha256(manifest);
    manifest.generatedAt = new Date().toISOString();

    const manifestPath = path.join(outDir, "manifest.json");
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    return { outDir, manifestPath, manifest };
}

/**
 * Converts an exported JSON value back into a driver parameter. Objects and
 * arrays (jsonb columns) are JSON-stringified; scalars pass through. Vector
 * columns were exported as pgvector text ("[...]") and pass through as text.
 */
function toParam(value: unknown): unknown {
    if (value !== null && typeof value === "object") return JSON.stringify(value);
    return value;
}

/**
 * Imports a previously exported corpus directory. Verifies the manifest
 * self-hash and every file hash BEFORE writing anything, refuses unknown
 * tables, then INSERTs in FK-safe order with ON CONFLICT DO NOTHING.
 * Returns per-table inserted counts.
 */
export async function importPublicCorpus(
    executor: QueryExecutor,
    options: { dir: string },
): Promise<Record<string, number>> {
    const dir = path.resolve(options.dir);
    const manifest = JSON.parse(
        readFileSync(path.join(dir, "manifest.json"), "utf8"),
    ) as CorpusManifest;

    if (manifest.schemaVersion !== 1) {
        throw new Error(`Unsupported corpus manifest schemaVersion ${manifest.schemaVersion}.`);
    }
    const computedSelf = manifestSelfSha256(manifest);
    if (!manifest.selfSha256 || computedSelf !== manifest.selfSha256) {
        throw new Error(
            `Refusing to import: manifest self-hash mismatch (recorded ${manifest.selfSha256}, computed ${computedSelf}).`,
        );
    }

    // Verify every table and file hash before the first INSERT so a tampered
    // or unknown artifact causes zero writes.
    const rowsByTable = new Map<PublicTable, Row[]>();
    for (const entry of manifest.tables) {
        assertAllowlisted(entry.name);
        const bytes = readFileSync(path.join(dir, `${entry.name}.jsonl`));
        const actual = fileSha256(bytes);
        if (actual !== entry.sha256) {
            throw new Error(
                `Refusing to import ${entry.name}: file hash mismatch (manifest ${entry.sha256}, actual ${actual}).`,
            );
        }
        const rows = bytes
            .toString("utf8")
            .split("\n")
            .filter((line) => line.length > 0)
            .map((line) => JSON.parse(line) as Row);
        if (rows.length !== entry.rowCount) {
            throw new Error(
                `Refusing to import ${entry.name}: manifest declares ${entry.rowCount} rows, file has ${rows.length}.`,
            );
        }
        rowsByTable.set(entry.name, rows);
    }

    const inserted: Record<string, number> = {};
    for (const table of PUBLIC_EXPORT_ALLOWLIST) {
        const rows = rowsByTable.get(table);
        if (!rows) continue;
        inserted[table] = 0;
        if (rows.length > 0) {
            // Multi-row INSERTs: one round-trip per chunk instead of per row
            // (a per-row loop costs ~150-300ms × 37k rows against Neon).
            // Every exported row of a table shares the same column set.
            const columns = Object.keys(rows[0]).sort();
            columns.forEach(assertIdentifier);
            for (const row of rows) {
                const keys = Object.keys(row).sort();
                if (keys.length !== columns.length || keys.some((key, i) => key !== columns[i])) {
                    throw new Error(
                        `Refusing to import ${table}: inconsistent column set across exported rows.`,
                    );
                }
            }
            const rowsPerStatement = table === "articles" ? 100 : 400;
            for (let offset = 0; offset < rows.length; offset += rowsPerStatement) {
                const chunk = rows.slice(offset, offset + rowsPerStatement);
                const params: unknown[] = [];
                const tuples = chunk.map((row) => {
                    const placeholders = columns.map((column) => {
                        params.push(toParam(row[column]));
                        return `$${params.length}`;
                    });
                    return `(${placeholders.join(", ")})`;
                });
                const result = await executor.query({
                    text:
                        `INSERT INTO ${table} (${columns.join(", ")}) ` +
                        `VALUES ${tuples.join(", ")} ON CONFLICT DO NOTHING RETURNING 1 AS inserted`,
                    params,
                });
                inserted[table] += result.length;
            }
        }
        if (table === "ads" && rows.length > 0) {
            // ads.id is SERIAL; advance the sequence past the imported ids.
            await executor.query({
                text:
                    "SELECT setval(pg_get_serial_sequence('ads', 'id'), " +
                    "(SELECT COALESCE(MAX(id), 0) + 1 FROM ads), false)",
            });
        }
    }
    return inserted;
}

function fail(message: string): never {
    console.error(`ERROR: ${message}`);
    process.exit(1);
}

async function main(): Promise<void> {
    const { values } = parseArgs({
        options: {
            export: { type: "string" },
            import: { type: "string" },
            yes: { type: "boolean", default: false },
        },
        strict: true,
    });

    loadLocalEnv();
    if (!process.env.DATABASE_URL) fail("DATABASE_URL is required.");
    if (!values.yes) {
        fail(
            "This phase authorizes local/test databases only. Re-run with --yes to confirm the target database is not production.",
        );
    }
    if (values.export && values.import) fail("--export and --import are mutually exclusive.");
    if (!values.export && !values.import) fail("One of --export <dir> or --import <dir> is required.");

    const executor = createNeonExecutor(process.env.DATABASE_URL);
    // --export reads only the legacy public tables, which exist on an
    // unmigrated database (e.g. approved read-only production export).
    // --import writes and requires a fully migrated target.
    if (values.import) {
        await assertMigrationsCurrent(executor);
    }

    if (values.export) {
        console.log(
            "export-public-corpus: READ-ONLY against the database (SELECTs over the public " +
                `allowlist only: ${PUBLIC_EXPORT_ALLOWLIST.join(", ")}); writes JSONL + manifest.json ` +
                "locally under the --export directory.",
        );
        const result = await exportPublicCorpus(executor, { outDir: values.export });
        console.log(
            JSON.stringify(
                {
                    outDir: result.outDir,
                    manifestPath: result.manifestPath,
                    selfSha256: result.manifest.selfSha256,
                    tables: result.manifest.tables,
                    excludedTables: result.manifest.excludedTables.map((entry) => entry.name),
                },
                null,
                2,
            ),
        );
        return;
    }

    const counts = await importPublicCorpus(executor, { dir: values.import as string });
    console.log(JSON.stringify({ dir: path.resolve(values.import as string), inserted: counts }, null, 2));
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === path.resolve(fileURLToPath(import.meta.url))) {
    main().catch((error) => {
        console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    });
}
