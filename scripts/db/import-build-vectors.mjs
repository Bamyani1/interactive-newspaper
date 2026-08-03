/**
 * Import a previously exported RAG index build — build row plus embedded
 * chunk/image vectors — into the DATABASE_URL target WITHOUT re-embedding.
 * This is the production-rollout path: vectors bought once are moved, never
 * re-purchased.
 *
 * Contract:
 * - Every file's SHA-256 must match manifest.json before anything is written.
 * - content_revision_id values are REMAPPED through the target's
 *   legacy_content_aliases: revision row ids hash per-run content-item ULIDs
 *   (see scripts/db/backfill-identities.mjs) and are never portable between
 *   identity backfills. Rows whose article has no alias in the target abort
 *   the import.
 * - Idempotent: all inserts are ON CONFLICT (id) DO NOTHING, and the final
 *   embedded-row counts must equal the manifest's dbCounts exactly.
 * - The build's corpus_version must already be registered in the target's
 *   corpus_versions table; an existing build row must match the manifest's
 *   identity columns.
 *
 * Export directories are produced by the evacuation flow (SELECT * of
 * embedded rows for one build as JSONL + self-describing manifest.json).
 *
 * Usage (tsx required — static .ts imports):
 *   DATABASE_URL=... npx tsx scripts/db/import-build-vectors.mjs --dir <exportDir> --yes
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// The migration runner and Neon executor are loaded lazily inside main()
// (mirroring build-rag-index.mjs) so importing this module's library
// functions never drags the database driver into test processes.

const BATCH_ROWS = 100;

const CHUNK_COLS = [
    "id", "index_build_id", "article_id", "chunk_index", "chunk_text",
    "embedding", "embedding_model", "embedding_input_version",
    "embedding_input_hash", "content_revision_id",
];
const CHUNK_CASTS = [null, null, null, "::int", null, "::vector", null, null, null, null];
const IMAGE_COLS = [
    "id", "index_build_id", "article_id", "image_index", "image_url", "caption",
    "embedding", "embedding_model", "embedding_input_version",
    "embedding_input_hash", "content_revision_id",
];
const IMAGE_CASTS = [null, null, null, "::int", null, null, "::vector", null, null, null, null];

/** Identity columns an existing build row must agree on for idempotent reuse. */
const BUILD_IDENTITY_COLUMNS = [
    "corpus_version", "pipeline_version", "embedding_model",
    "text_embedding_input_version", "image_embedding_input_version",
];

function sha256Hex(buffer) {
    return createHash("sha256").update(buffer).digest("hex");
}

/** Verify every manifest-listed file's hash; returns the parsed manifest. */
export function verifyExportDir(dir) {
    const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8"));
    if (!manifest.buildId || !manifest.files || !manifest.dbCounts) {
        throw new Error("manifest.json is missing buildId, files, or dbCounts.");
    }
    for (const [name, meta] of Object.entries(manifest.files)) {
        const actual = sha256Hex(readFileSync(path.join(dir, name)));
        if (actual !== meta.sha256) {
            throw new Error(`${name} failed hash verification: expected ${meta.sha256}, got ${actual}.`);
        }
    }
    return manifest;
}

function loadJsonl(dir, name) {
    return readFileSync(path.join(dir, name), "utf8")
        .trimEnd()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
}

async function loadRevisionMap(executor) {
    const rows = await executor.query({
        text: `SELECT legacy_id, content_revision_id FROM legacy_content_aliases
               WHERE content_revision_id IS NOT NULL`,
        params: [],
    });
    return new Map(rows.map((row) => [row.legacy_id, row.content_revision_id]));
}

const IMPORTABLE_STATUSES = new Set(["validated", "active"]);

async function insertBuildRow(executor, sourceRow) {
    if (!IMPORTABLE_STATUSES.has(String(sourceRow.status))) {
        throw new Error(
            `Export build status '${sourceRow.status}' is not importable; only completed ` +
                `(validated/active) builds move between databases.`,
        );
    }
    // The build always lands 'validated': activation is an explicit, audited
    // transition on the TARGET (--activate), never inherited from the source.
    const buildRow = { ...sourceRow, status: "validated", activated_at: null };
    const cols = Object.keys(buildRow);
    await executor.query({
        text: `INSERT INTO rag_index_builds (${cols.join(", ")})
               VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})
               ON CONFLICT (id) DO NOTHING`,
        params: cols.map((c) => buildRow[c]),
    });
    const [existing] = await executor.query({
        text: `SELECT * FROM rag_index_builds WHERE id = $1`,
        params: [buildRow.id],
    });
    for (const column of BUILD_IDENTITY_COLUMNS) {
        if (String(existing[column]) !== String(buildRow[column])) {
            throw new Error(
                `Existing build ${buildRow.id} disagrees on ${column}: ` +
                    `target has ${existing[column]}, export has ${buildRow[column]}.`,
            );
        }
    }
}

async function importTable(executor, dir, table, file, cols, casts, revisionMap, log) {
    const rows = loadJsonl(dir, file).map((row) => {
        const localRevision = revisionMap.get(row.article_id);
        if (!localRevision) {
            throw new Error(`No target revision alias for article ${row.article_id} (${table}).`);
        }
        return { ...row, content_revision_id: localRevision };
    });
    let inserted = 0;
    for (let offset = 0; offset < rows.length; offset += BATCH_ROWS) {
        const batch = rows.slice(offset, offset + BATCH_ROWS);
        const params = [];
        const tuples = batch.map((row) => {
            const parts = cols.map((column, i) => {
                params.push(row[column]);
                return `$${params.length}${casts[i] ?? ""}`;
            });
            return `(${parts.join(", ")})`;
        });
        const returned = await executor.query({
            text: `INSERT INTO ${table} (${cols.join(", ")}) VALUES ${tuples.join(", ")}
                   ON CONFLICT (id) DO NOTHING RETURNING 1`,
            params,
        });
        inserted += returned.length;
        if ((offset / BATCH_ROWS) % 20 === 0 || offset + BATCH_ROWS >= rows.length) {
            log(`${table}: ${Math.min(offset + BATCH_ROWS, rows.length)}/${rows.length} processed (+${inserted} new)`);
        }
    }
    return { total: rows.length, inserted };
}

export async function importBuildVectors(executor, { dir, log = () => {} } = {}) {
    if (!dir) throw new Error("importBuildVectors requires options.dir.");
    const manifest = verifyExportDir(dir);
    const buildRow = JSON.parse(readFileSync(path.join(dir, "rag_index_builds.json"), "utf8"));
    if (buildRow.id !== manifest.buildId) {
        throw new Error(`Build row id ${buildRow.id} does not match manifest buildId ${manifest.buildId}.`);
    }

    const corpus = await executor.query({
        text: `SELECT 1 FROM corpus_versions WHERE id = $1`,
        params: [buildRow.corpus_version],
    });
    if (corpus.length === 0) {
        throw new Error(
            `corpus_version ${buildRow.corpus_version} is not registered in the target database; ` +
                `run the corpus setup before importing a build for it.`,
        );
    }

    await insertBuildRow(executor, buildRow);
    const revisionMap = await loadRevisionMap(executor);

    const chunks = await importTable(
        executor, dir, "article_chunks", "article_chunks.jsonl",
        CHUNK_COLS, CHUNK_CASTS, revisionMap, log,
    );
    const images = manifest.files["article_images.jsonl"]
        ? await importTable(
              executor, dir, "article_images", "article_images.jsonl",
              IMAGE_COLS, IMAGE_CASTS, revisionMap, log,
          )
        : { total: 0, inserted: 0 };

    const [counts] = await executor.query({
        text: `SELECT
                   (SELECT COUNT(*)::int FROM article_chunks
                    WHERE index_build_id = $1 AND embedding IS NOT NULL) AS chunks,
                   (SELECT COUNT(*)::int FROM article_images
                    WHERE index_build_id = $1 AND embedding IS NOT NULL) AS images`,
        params: [manifest.buildId],
    });
    const embedded = { chunks: Number(counts.chunks), images: Number(counts.images) };
    if (embedded.chunks !== manifest.dbCounts.chunks || embedded.images !== manifest.dbCounts.images) {
        throw new Error(
            `Post-import counts ${JSON.stringify(embedded)} do not equal manifest dbCounts ` +
                `${JSON.stringify(manifest.dbCounts)}; the import is incomplete or the export is stale.`,
        );
    }
    return {
        buildId: manifest.buildId,
        insertedChunks: chunks.inserted,
        insertedImages: images.inserted,
        embedded,
    };
}

function argValue(flag) {
    const index = process.argv.indexOf(flag);
    if (index === -1 || index + 1 >= process.argv.length) return null;
    return process.argv[index + 1];
}

async function main() {
    const dir = argValue("--dir");
    if (!dir) throw new Error("--dir <exportDir> is required.");
    if (!process.argv.includes("--yes")) {
        throw new Error("This command writes to the target database. Re-run with --yes to confirm.");
    }
    const databaseUrl = process.env.DATABASE_URL?.trim();
    if (!databaseUrl) throw new Error("DATABASE_URL is required.");
    const executorModule = await import("./lib/neon-executor");
    const runnerModule = await import("./lib/migration-runner");
    const { createNeonExecutor } = executorModule.default ?? executorModule;
    const { assertMigrationsCurrent } = runnerModule.default ?? runnerModule;
    const executor = createNeonExecutor(databaseUrl);
    await assertMigrationsCurrent(executor);
    const result = await importBuildVectors(executor, {
        dir: path.resolve(dir),
        log: (line) => process.stdout.write(`${line}\n`),
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
