#!/usr/bin/env node
/**
 * Isolated-evaluation-environment bootstrapper (Phase 7).
 *
 * Populates a FRESH evaluation database from a public-corpus export directory
 * (produced by scripts/rag/export-public-corpus.ts) and proves the result:
 *
 *   1. runMigrations — brings the eval DB to the canonical schema.
 *   2. Schema verification — an injected introspect function's snapshot must
 *      deep-equal the committed scripts/db/schema-snapshot.json.
 *   3. importPublicCorpus — verifies the export's manifest self-hash and every
 *      per-file hash itself before inserting anything.
 *   4. registerCorpusVersion — records the frozen corpus in corpus_versions.
 *   5. backfillIdentities — mints issues/content_items/aliases.
 *   6. Count verification — editions/articles/ads row counts must equal the
 *      frozen corpus JSON's counts (only its top-level schemaVersion /
 *      corpusVersion / counts keys are read).
 *
 * Safety: main() refuses to run unless EVAL_DATABASE_URL is set, is a valid
 * postgres URL, and provably differs from DATABASE_URL (host OR database name
 * must differ; equality with any *DATABASE_URL* env var also aborts). As a
 * belt-and-braces guard the eval database name or host must contain "eval";
 * pass --allow-nonstandard-name to accept a deliberately different naming
 * scheme. The database connection is only ever created inside main().
 *
 * Executor-injectable: tests drive setupEvalDb(executor, options) against
 * PGlite with an injected introspect + a synthetic frozen-corpus JSON.
 *
 * Usage:
 *   EVAL_DATABASE_URL=postgres://user:pw@host/eval_db \
 *     npm run rag:setup-eval-db -- --export-dir <dir> --yes [--allow-nonstandard-name]
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { backfillIdentities } from "../db/backfill-identities.mjs";
import { registerCorpusVersion } from "../db/register-corpus-version.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SCHEMA_SNAPSHOT_PATH = path.resolve(scriptDir, "../db/schema-snapshot.json");
const DEFAULT_CORPUS_JSON_PATH = path.resolve(
    scriptDir,
    "../../evaluation/rag/corpus/legacy-8b8207373510d69e.json",
);

// This package compiles .ts to CJS (no "type":"module"), so .ts modules must
// be loaded dynamically and unwrapped via `mod.default ?? mod`.
async function loadMigrationRunner() {
    const mod = await import("../db/lib/migration-runner.ts");
    return mod.default ?? mod;
}

async function loadCorpusExporter() {
    const mod = await import("./export-public-corpus.ts");
    return mod.default ?? mod;
}

function parsePostgresUrl(rawUrl, label) {
    let url;
    try {
        url = new URL(rawUrl);
    } catch {
        throw new Error(`${label} is not a valid postgres URL (unparseable): refusing to run.`);
    }
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
        throw new Error(
            `${label} is not a valid postgres URL (protocol "${url.protocol}"; ` +
                "expected postgres:// or postgresql://).",
        );
    }
    const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
    if (!url.hostname || !database) {
        throw new Error(`${label} is not a valid postgres URL: host and database name are required.`);
    }
    return { host: url.hostname, database };
}

function tryParsePostgresUrl(rawUrl) {
    try {
        return parsePostgresUrl(rawUrl, "url");
    } catch {
        return null;
    }
}

/**
 * Refuses every way EVAL_DATABASE_URL could actually be production:
 * - unset/empty or not a valid postgres URL;
 * - identical string to prodUrl, or same host AND same database as prodUrl;
 * - equal to any *DATABASE_URL* variable in the environment (except EVAL_*),
 *   which also covers the prodUrl-unset case;
 * - belt-and-braces: neither its database name nor host contains "eval" and
 *   allowNonstandardName (CLI: --allow-nonstandard-name) was not given.
 *
 * Returns { host, database } of the validated eval target for the banner.
 */
export function assertNotProductionUrl(evalUrl, prodUrl, options = {}) {
    const { env = process.env, allowNonstandardName = false } = options;

    if (typeof evalUrl !== "string" || evalUrl.trim() === "") {
        throw new Error("EVAL_DATABASE_URL is required and is not set; refusing to run.");
    }
    const evalParts = parsePostgresUrl(evalUrl, "EVAL_DATABASE_URL");

    if (typeof prodUrl === "string" && prodUrl.trim() !== "") {
        if (evalUrl === prodUrl) {
            throw new Error(
                "EVAL_DATABASE_URL is identical to DATABASE_URL; refusing to touch what may be production.",
            );
        }
        const prodParts = tryParsePostgresUrl(prodUrl);
        if (
            prodParts &&
            prodParts.host === evalParts.host &&
            prodParts.database === evalParts.database
        ) {
            throw new Error(
                "EVAL_DATABASE_URL points at the same host AND database as DATABASE_URL " +
                    `(${evalParts.host}/${evalParts.database}); it must differ in host or database name.`,
            );
        }
    }

    // Even when prodUrl is unset, refuse an eval URL that equals any
    // *DATABASE_URL* variable present in the environment (EVAL_* excluded).
    for (const [key, value] of Object.entries(env)) {
        if (!key.includes("DATABASE_URL") || key.includes("EVAL")) continue;
        if (value === evalUrl) {
            throw new Error(
                `EVAL_DATABASE_URL equals ${key} in the environment; refusing to touch what may be production.`,
            );
        }
    }

    if (
        !allowNonstandardName &&
        !/eval/i.test(evalParts.host) &&
        !/eval/i.test(evalParts.database)
    ) {
        throw new Error(
            `Belt-and-braces check failed: neither the database name "${evalParts.database}" nor ` +
                `the host "${evalParts.host}" contains "eval". Name the evaluation database with ` +
                '"eval" in it, or re-run with --allow-nonstandard-name to accept this target.',
        );
    }

    return { host: evalParts.host, database: evalParts.database };
}

/**
 * Executor-based schema introspection for the real (Neon) path.
 *
 * Source of truth: tests/db/helpers/pglite.ts introspectSchema — the SQL
 * queries, orderings, and result shape below are duplicated from it verbatim
 * (that helper cannot be imported here: it pulls in PGlite and deletes
 * process.env.DATABASE_URL at module load). Keep the two in sync.
 */
export async function introspectSchemaViaExecutor(executor) {
    const tablesResult = await executor.query({
        text: "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
    });

    const tables = {};
    for (const row of tablesResult) {
        const tablename = String(row.tablename);
        const columns = await executor.query({
            text: `SELECT column_name, data_type, is_nullable, column_default, udt_name
                   FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = $1
                   ORDER BY column_name`,
            params: [tablename],
        });
        const constraints = await executor.query({
            text: `SELECT conname || ' ' || pg_get_constraintdef(oid) AS def
                   FROM pg_constraint
                   WHERE conrelid = $1::regclass
                   ORDER BY conname`,
            params: [tablename],
        });
        tables[tablename] = {
            columns: columns.map((col) => ({
                name: col.column_name,
                dataType: col.data_type === "USER-DEFINED" ? col.udt_name : col.data_type,
                nullable: col.is_nullable === "YES",
                default: col.column_default,
            })),
            constraints: constraints.map((con) => con.def),
        };
    }

    const indexes = await executor.query({
        text: "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname",
    });
    const triggers = await executor.query({
        text: `SELECT t.tgname, pg_get_triggerdef(t.oid) AS def
               FROM pg_trigger t
               JOIN pg_class c ON c.oid = t.tgrelid
               JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'public' AND NOT t.tgisinternal
               ORDER BY t.tgname`,
    });
    // prokind = 'f' and the pg_depend filter exclude extension-owned functions
    // and aggregates (pg_get_functiondef raises on pgvector's aggregates).
    const functions = await executor.query({
        text: `SELECT p.proname, pg_get_functiondef(p.oid) AS def
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
    });
    const extensions = await executor.query({
        text: "SELECT extname FROM pg_extension ORDER BY extname",
    });

    return {
        tables,
        indexes: Object.fromEntries(indexes.map((row) => [row.indexname, row.indexdef])),
        triggers: Object.fromEntries(triggers.map((row) => [row.tgname, row.def])),
        functions: Object.fromEntries(functions.map((row) => [row.proname, row.def])),
        extensions: extensions.map((row) => row.extname),
    };
}

const MAX_SCHEMA_DIFFS = 12;

function describeValue(value) {
    const text = JSON.stringify(value);
    if (typeof text === "string" && text.length > 120) return `${text.slice(0, 117)}...`;
    return String(text);
}

/** Collects human-readable paths where two JSON-shaped values differ. */
function collectSchemaDiffs(expected, actual, at, out) {
    if (out.length >= MAX_SCHEMA_DIFFS || expected === actual) return;
    const bothArrays = Array.isArray(expected) && Array.isArray(actual);
    const bothObjects =
        !bothArrays &&
        typeof expected === "object" &&
        expected !== null &&
        !Array.isArray(expected) &&
        typeof actual === "object" &&
        actual !== null &&
        !Array.isArray(actual);

    if (bothArrays) {
        if (expected.length !== actual.length) {
            out.push(
                `${at}: snapshot has ${expected.length} entries, live schema has ${actual.length}`,
            );
            return;
        }
        for (let index = 0; index < expected.length; index += 1) {
            collectSchemaDiffs(expected[index], actual[index], `${at}[${index}]`, out);
        }
        return;
    }
    if (bothObjects) {
        const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
        for (const key of keys) {
            if (out.length >= MAX_SCHEMA_DIFFS) return;
            const childAt = at ? `${at}.${key}` : key;
            if (!(key in actual)) {
                out.push(`${childAt}: present in snapshot, missing from live schema`);
            } else if (!(key in expected)) {
                out.push(`${childAt}: missing from snapshot, present in live schema`);
            } else {
                collectSchemaDiffs(expected[key], actual[key], childAt, out);
            }
        }
        return;
    }
    out.push(`${at}: snapshot ${describeValue(expected)}, live schema ${describeValue(actual)}`);
}

/**
 * Reads ONLY the top-level schemaVersion / corpusVersion / counts keys of the
 * frozen corpus JSON; every other field is deliberately ignored.
 */
export function readFrozenCorpusMeta(corpusJsonPath) {
    const parsed = JSON.parse(readFileSync(corpusJsonPath, "utf8"));
    const corpusVersion = String(parsed.corpusVersion ?? "");
    if (!corpusVersion) {
        throw new Error(`corpusVersion missing in ${corpusJsonPath}`);
    }
    if (typeof parsed.counts !== "object" || parsed.counts === null) {
        throw new Error(`counts missing in ${corpusJsonPath}`);
    }
    return { schemaVersion: parsed.schemaVersion, corpusVersion, counts: parsed.counts };
}

/** Tables whose row counts must equal the frozen corpus JSON's counts. */
export const COUNT_VERIFIED_TABLES = Object.freeze(["editions", "articles", "ads"]);

/**
 * Bootstraps and verifies an evaluation database. `introspect` is injected so
 * callers choose the implementation: main() passes introspectSchemaViaExecutor
 * (Neon-capable); tests pass the PGlite helper. Options:
 * - exportDir (required): public-corpus export directory to import.
 * - introspect (required): async (executor) => schema snapshot.
 * - corpusJsonPath: frozen corpus JSON (injectable for tests).
 * - schemaSnapshotPath: committed snapshot to verify against.
 * - migrationsDir: migrations directory override.
 */
export async function setupEvalDb(executor, options) {
    const {
        exportDir,
        introspect,
        corpusJsonPath = DEFAULT_CORPUS_JSON_PATH,
        schemaSnapshotPath = DEFAULT_SCHEMA_SNAPSHOT_PATH,
        migrationsDir,
    } = options ?? {};
    if (!exportDir) throw new Error("setupEvalDb requires options.exportDir.");
    if (typeof introspect !== "function") {
        throw new Error("setupEvalDb requires options.introspect (injected introspection function).");
    }

    // (1) Migrations.
    const { runMigrations } = await loadMigrationRunner();
    await runMigrations(executor, migrationsDir ? { dir: migrationsDir } : {});

    // (2) Schema verification against the committed snapshot.
    const committedSnapshot = JSON.parse(readFileSync(schemaSnapshotPath, "utf8"));
    const liveSnapshot = await introspect(executor);
    const schemaDiffs = [];
    collectSchemaDiffs(committedSnapshot, liveSnapshot, "", schemaDiffs);
    if (schemaDiffs.length > 0) {
        throw new Error(
            `Schema verification failed: the migrated evaluation database does not match ${schemaSnapshotPath}:\n` +
                schemaDiffs.map((diff) => `  - ${diff}`).join("\n"),
        );
    }

    // (3) Corpus import (verifies manifest self-hash + file hashes itself).
    const { importPublicCorpus } = await loadCorpusExporter();
    const imported = await importPublicCorpus(executor, { dir: exportDir });

    // (4) Corpus-version registration.
    const registration = await registerCorpusVersion(executor, corpusJsonPath);

    // (5) Identity backfill.
    const identity = await backfillIdentities(executor);

    // (6) Count verification against the frozen corpus JSON.
    const meta = readFrozenCorpusMeta(corpusJsonPath);
    const mismatches = [];
    for (const table of COUNT_VERIFIED_TABLES) {
        const rows = await executor.query({ text: `SELECT count(*)::int AS n FROM ${table}` });
        const databaseCount = Number(rows[0].n);
        const corpusCount = Number(meta.counts[table]);
        if (databaseCount !== corpusCount) {
            mismatches.push(
                `${table}: frozen corpus declares ${meta.counts[table]}, evaluation database has ${databaseCount}`,
            );
        }
    }
    if (mismatches.length > 0) {
        throw new Error(
            `Corpus count verification failed against ${corpusJsonPath}:\n` +
                mismatches.map((line) => `  - ${line}`).join("\n"),
        );
    }

    return {
        schemaVerified: true,
        imported,
        identity,
        corpusVersion: registration.id,
    };
}

function fail(message) {
    console.error(`ERROR: ${message}`);
    process.exit(1);
}

async function main() {
    const { values } = parseArgs({
        options: {
            "export-dir": { type: "string" },
            yes: { type: "boolean", default: false },
            "allow-nonstandard-name": { type: "boolean", default: false },
        },
        strict: true,
    });

    const envMod = await import("../lib/local-env.ts");
    const { loadLocalEnv } = envMod.default ?? envMod;
    loadLocalEnv();

    if (!process.env.EVAL_DATABASE_URL) fail("EVAL_DATABASE_URL is required.");
    if (!values["export-dir"]) fail("--export-dir <dir> is required.");
    if (!values.yes) {
        fail(
            "This command writes to the evaluation database. Re-run with --yes to confirm " +
                "EVAL_DATABASE_URL points at the isolated evaluation database.",
        );
    }

    const target = assertNotProductionUrl(process.env.EVAL_DATABASE_URL, process.env.DATABASE_URL, {
        allowNonstandardName: Boolean(values["allow-nonstandard-name"]),
    });
    console.log(
        `setup-eval-db: target evaluation database is host=${target.host} db=${target.database} ` +
            "(verified distinct from DATABASE_URL). Running migrations, schema verification, " +
            "corpus import, corpus-version registration, identity backfill, and count verification.",
    );

    const neonMod = await import("../db/lib/neon-executor.ts");
    const { createNeonExecutor } = neonMod.default ?? neonMod;
    const executor = createNeonExecutor(process.env.EVAL_DATABASE_URL);

    const result = await setupEvalDb(executor, {
        exportDir: values["export-dir"],
        introspect: introspectSchemaViaExecutor,
    });
    console.log(JSON.stringify(result, null, 2));
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entryPath === fileURLToPath(import.meta.url)) {
    main().catch((error) => {
        console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    });
}
