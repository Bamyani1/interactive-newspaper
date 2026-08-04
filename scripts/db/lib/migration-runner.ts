import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sha256Hex, splitSqlStatements, stripComments } from "./sql-statements";

export interface SqlStatement {
    text: string;
    params?: unknown[];
}

export interface QueryExecutor {
    query(stmt: SqlStatement): Promise<Record<string, unknown>[]>;
    /** Executes every statement inside one transaction; throws on any failure. */
    transactionBatch(stmts: SqlStatement[]): Promise<void>;
}

export const RUNNER_VERSION = "migration-runner-v1";

/**
 * Fixed advisory-lock key pair. The lock is transaction-scoped
 * (pg_advisory_xact_lock), so the non-interactive HTTP transaction holds it
 * exactly for the duration of one migration batch.
 */
export const MIGRATION_LOCK_KEY: readonly [number, number] = [727401, 552023];

export const LEDGER_TABLE = "schema_migrations";

const LEDGER_DDL = `CREATE TABLE IF NOT EXISTS ${LEDGER_TABLE} (
  id             TEXT PRIMARY KEY,
  checksum       TEXT NOT NULL,
  applied_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration_ms    INTEGER,
  runner_version TEXT NOT NULL
)`;

/**
 * Registry of every table the canonical migrations manage.
 *
 * kind "reseedable": derived from edition.json / rebuildable artifacts; dropped
 * by db:reset. kind "runtime": user/privacy/operational state (sessions,
 * feedback, spend, rate limits); preserved by db:reset unless --include-runtime.
 * The ledger itself is always dropped on reset so migrations re-record cleanly;
 * preserved runtime tables simply no-op their IF NOT EXISTS DDL.
 */
export const CANONICAL_TABLES: ReadonlyArray<{ name: string; kind: "reseedable" | "runtime" }> = [
    { name: "editions", kind: "reseedable" },
    { name: "articles", kind: "reseedable" },
    { name: "ads", kind: "reseedable" },
    { name: "weather", kind: "reseedable" },
    { name: "music", kind: "reseedable" },
    { name: "rag_index_builds", kind: "reseedable" },
    { name: "article_chunks", kind: "reseedable" },
    { name: "article_images", kind: "reseedable" },
    { name: "source_records", kind: "reseedable" },
    { name: "issues", kind: "reseedable" },
    { name: "legacy_edition_aliases", kind: "reseedable" },
    { name: "publication_runs", kind: "reseedable" },
    { name: "publication_run_events", kind: "reseedable" },
    { name: "edition_revisions", kind: "reseedable" },
    { name: "edition_revision_pages", kind: "reseedable" },
    { name: "content_items", kind: "reseedable" },
    { name: "content_revisions", kind: "reseedable" },
    { name: "legacy_content_aliases", kind: "reseedable" },
    { name: "content_identity_conflicts", kind: "reseedable" },
    { name: "assets", kind: "reseedable" },
    { name: "asset_references", kind: "reseedable" },
    { name: "corpus_versions", kind: "reseedable" },
    { name: "ask_session_turns", kind: "runtime" },
    { name: "ask_feedback", kind: "runtime" },
    { name: "ai_spend_counter", kind: "runtime" },
    { name: "api_rate_bucket", kind: "runtime" },
    { name: "answer_cache", kind: "runtime" },
];

export interface MigrationFile {
    id: string;
    fileName: string;
    checksum: string;
    statements: string[];
}

const FILE_NAME_PATTERN = /^(\d{4})_[a-z0-9_]+\.sql$/;

/**
 * Statements that cannot run inside a transaction (or that migrations must
 * never contain). Checked against comment-stripped statement text.
 */
const FORBIDDEN_TOKEN_PATTERN = /\b(CONCURRENTLY|VACUUM)\b/i;

export function defaultMigrationsDir(): string {
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");
}

export function discoverMigrations(dir: string): MigrationFile[] {
    const entries = readdirSync(dir)
        .filter((name) => name.endsWith(".sql"))
        .sort();

    const seenPrefixes = new Set<string>();
    const migrations: MigrationFile[] = [];
    for (const fileName of entries) {
        const match = FILE_NAME_PATTERN.exec(fileName);
        if (!match) {
            throw new Error(
                `Migration file name "${fileName}" is invalid; expected NNNN_snake_case.sql`,
            );
        }
        const prefix = match[1];
        if (seenPrefixes.has(prefix)) {
            throw new Error(`Duplicate migration prefix "${prefix}" (${fileName})`);
        }
        seenPrefixes.add(prefix);

        const raw = readFileSync(path.join(dir, fileName), "utf8");
        const statements = splitSqlStatements(raw);
        if (statements.length === 0) {
            throw new Error(`Migration "${fileName}" contains no statements`);
        }
        for (const stmt of statements) {
            const bare = stripComments(stmt);
            if (FORBIDDEN_TOKEN_PATTERN.test(bare)) {
                throw new Error(
                    `Migration "${fileName}" contains a statement that cannot run inside a transaction: ${bare.trim().slice(0, 80)}`,
                );
            }
        }
        migrations.push({
            id: fileName.replace(/\.sql$/, ""),
            fileName,
            checksum: sha256Hex(raw),
            statements,
        });
    }
    return migrations;
}

async function readLedger(executor: QueryExecutor): Promise<Map<string, string>> {
    await executor.query({ text: LEDGER_DDL });
    const rows = await executor.query({
        text: `SELECT id, checksum FROM ${LEDGER_TABLE} ORDER BY id`,
    });
    return new Map(rows.map((row) => [String(row.id), String(row.checksum)]));
}

function verifyAppliedChecksums(applied: Map<string, string>, migrations: MigrationFile[]): void {
    const byId = new Map(migrations.map((m) => [m.id, m]));
    for (const [id, checksum] of applied) {
        const onDisk = byId.get(id);
        if (!onDisk) {
            throw new Error(
                `Applied migration "${id}" has no matching file on disk. Applied migrations are immutable; restore the file rather than deleting it.`,
            );
        }
        if (onDisk.checksum !== checksum) {
            throw new Error(
                `Checksum mismatch for applied migration "${id}". Applied migrations are immutable; add a new migration instead of editing an applied one.`,
            );
        }
    }
}

/** Builds the single transactional batch used to apply one migration. */
export function buildMigrationBatch(migration: MigrationFile, runnerVersion: string): SqlStatement[] {
    return [
        { text: `SELECT pg_advisory_xact_lock(${MIGRATION_LOCK_KEY[0]}, ${MIGRATION_LOCK_KEY[1]})` },
        ...migration.statements.map((text) => ({ text })),
        {
            text: `INSERT INTO ${LEDGER_TABLE} (id, checksum, duration_ms, runner_version) VALUES ($1, $2, $3, $4)`,
            params: [migration.id, migration.checksum, 0, runnerVersion],
        },
    ];
}

function isLedgerUniqueViolation(error: unknown): boolean {
    if (typeof error !== "object" || error === null) return false;
    const code = (error as { code?: unknown }).code;
    const message = String((error as { message?: unknown }).message ?? "");
    return code === "23505" || (message.includes("duplicate key") && message.includes(LEDGER_TABLE));
}

export interface RunMigrationsResult {
    applied: string[];
    skipped: string[];
    alreadyApplied: string[];
}

export async function runMigrations(
    executor: QueryExecutor,
    options: { dir?: string; runnerVersion?: string } = {},
): Promise<RunMigrationsResult> {
    const dir = options.dir ?? defaultMigrationsDir();
    const runnerVersion = options.runnerVersion ?? RUNNER_VERSION;
    const migrations = discoverMigrations(dir);
    const ledger = await readLedger(executor);
    verifyAppliedChecksums(ledger, migrations);

    const applied: string[] = [];
    const skipped: string[] = [];
    const alreadyApplied: string[] = [];

    for (const migration of migrations) {
        if (ledger.has(migration.id)) {
            alreadyApplied.push(migration.id);
            continue;
        }
        try {
            await executor.transactionBatch(buildMigrationBatch(migration, runnerVersion));
            applied.push(migration.id);
        } catch (error) {
            if (isLedgerUniqueViolation(error)) {
                // A concurrent runner won the advisory-lock race and committed
                // this migration first; our entire batch (including DDL) rolled
                // back with the failed ledger INSERT.
                skipped.push(migration.id);
                continue;
            }
            throw new Error(
                `Migration "${migration.id}" failed: ${error instanceof Error ? error.message : String(error)}`,
                { cause: error },
            );
        }
    }

    return { applied, skipped, alreadyApplied };
}

export interface MigrationStatus {
    applied: string[];
    pending: string[];
}

export async function migrationStatus(
    executor: QueryExecutor,
    options: { dir?: string } = {},
): Promise<MigrationStatus> {
    const dir = options.dir ?? defaultMigrationsDir();
    const migrations = discoverMigrations(dir);
    const ledger = await readLedger(executor);
    verifyAppliedChecksums(ledger, migrations);
    return {
        applied: migrations.filter((m) => ledger.has(m.id)).map((m) => m.id),
        pending: migrations.filter((m) => !ledger.has(m.id)).map((m) => m.id),
    };
}

/**
 * Read-only preflight for data-only commands (seed, backfills): succeeds only
 * when every on-disk migration is applied with a matching checksum.
 */
export async function assertMigrationsCurrent(
    executor: QueryExecutor,
    options: { dir?: string } = {},
): Promise<void> {
    const dir = options.dir ?? defaultMigrationsDir();
    const migrations = discoverMigrations(dir);

    let rows: Record<string, unknown>[];
    try {
        rows = await executor.query({
            text: `SELECT id, checksum FROM ${LEDGER_TABLE} ORDER BY id`,
        });
    } catch {
        throw new Error(
            `The ${LEDGER_TABLE} ledger does not exist. This database has not been migrated; run: npm run db:migrate`,
        );
    }

    const ledger = new Map(rows.map((row) => [String(row.id), String(row.checksum)]));
    verifyAppliedChecksums(ledger, migrations);
    const pending = migrations.filter((m) => !ledger.has(m.id)).map((m) => m.id);
    if (pending.length > 0) {
        throw new Error(
            `Pending migrations: ${pending.join(", ")}. Data commands never run DDL; run: npm run db:migrate`,
        );
    }
}
