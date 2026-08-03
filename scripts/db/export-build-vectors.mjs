/**
 * Export one RAG index build — build row plus embedded chunk/image vectors —
 * from DATABASE_URL to a directory of JSONL files with a SHA-256 manifest.
 * READ-ONLY against the database; the output feeds
 * scripts/db/import-build-vectors.mjs so vectors bought once can move between
 * databases without re-embedding.
 *
 * Resumable: an interrupted export re-run appends from the last row id
 * already on disk (keyset pagination on the primary key). Delete the output
 * directory for a from-scratch export; the manifest is only written on a
 * complete run, and import refuses any directory whose hashes don't match.
 *
 * Usage (tsx required — static .ts imports in the executor):
 *   DATABASE_URL=... npx tsx scripts/db/export-build-vectors.mjs \
 *     --build <buildId> --out <dir> [--limit <n>]
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PAGE_SIZE = 400;

/** Table -> (file, keyset query). Table names are constants, never input. */
const TABLES = [
    {
        table: "article_chunks",
        file: "article_chunks.jsonl",
        text: `SELECT id, index_build_id, article_id, chunk_index, chunk_text,
                      embedding::text AS embedding, embedding_model,
                      embedding_input_version, embedding_input_hash, content_revision_id
               FROM article_chunks
               WHERE index_build_id = $1 AND embedding IS NOT NULL AND id > $2
               ORDER BY id LIMIT $3`,
    },
    {
        table: "article_images",
        file: "article_images.jsonl",
        text: `SELECT id, index_build_id, article_id, image_index, image_url, caption,
                      embedding::text AS embedding, embedding_model,
                      embedding_input_version, embedding_input_hash, content_revision_id
               FROM article_images
               WHERE index_build_id = $1 AND embedding IS NOT NULL AND id > $2
               ORDER BY id LIMIT $3`,
    },
];

function lastIdInFile(filePath) {
    if (!existsSync(filePath)) return "";
    const lines = readFileSync(filePath, "utf8").trimEnd().split("\n").filter(Boolean);
    if (lines.length === 0) return "";
    return JSON.parse(lines[lines.length - 1]).id;
}

export async function exportBuildVectors(
    executor,
    { buildId, dir, maxRowsPerTable = Infinity, log = () => {} } = {},
) {
    if (!buildId) throw new Error("exportBuildVectors requires options.buildId.");
    if (!dir) throw new Error("exportBuildVectors requires options.dir.");
    mkdirSync(dir, { recursive: true });

    const [buildRow] = await executor.query({
        text: `SELECT * FROM rag_index_builds WHERE id = $1`,
        params: [buildId],
    });
    if (!buildRow) throw new Error(`Unknown index build ${buildId}.`);
    writeFileSync(
        path.join(dir, "rag_index_builds.json"),
        `${JSON.stringify(buildRow, null, 2)}\n`,
    );

    const exported = {};
    for (const { table, file, text } of TABLES) {
        const filePath = path.join(dir, file);
        let cursor = lastIdInFile(filePath);
        let count = 0;
        while (count < maxRowsPerTable) {
            const rows = await executor.query({
                text,
                params: [buildId, cursor, Math.min(PAGE_SIZE, maxRowsPerTable - count)],
            });
            if (rows.length === 0) break;
            appendFileSync(
                filePath,
                `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
            );
            count += rows.length;
            cursor = rows[rows.length - 1].id;
            log(`${table}: +${rows.length} (run total ${count}, cursor ${cursor})`);
        }
        exported[table] = count;
    }

    const [dbCounts] = await executor.query({
        text: `SELECT
                   (SELECT COUNT(*)::int FROM article_chunks
                    WHERE index_build_id = $1 AND embedding IS NOT NULL) AS chunks,
                   (SELECT COUNT(*)::int FROM article_images
                    WHERE index_build_id = $1 AND embedding IS NOT NULL) AS images`,
        params: [buildId],
    });

    const manifest = {
        buildId,
        files: {},
        dbCounts: { chunks: Number(dbCounts.chunks), images: Number(dbCounts.images) },
    };
    for (const name of ["rag_index_builds.json", ...TABLES.map((t) => t.file)]) {
        const filePath = path.join(dir, name);
        if (!existsSync(filePath)) continue;
        const buffer = readFileSync(filePath);
        manifest.files[name] = {
            sha256: createHash("sha256").update(buffer).digest("hex"),
            rows: name.endsWith(".jsonl")
                ? buffer.toString("utf8").trimEnd().split("\n").filter(Boolean).length
                : 1,
            bytes: buffer.length,
        };
    }
    const onDisk = {
        chunks: manifest.files["article_chunks.jsonl"]?.rows ?? 0,
        images: manifest.files["article_images.jsonl"]?.rows ?? 0,
    };
    const complete =
        onDisk.chunks === manifest.dbCounts.chunks &&
        onDisk.images === manifest.dbCounts.images;
    if (complete) {
        writeFileSync(path.join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    }
    return { buildId, exported, onDisk, dbCounts: manifest.dbCounts, complete };
}

function argValue(flag) {
    const index = process.argv.indexOf(flag);
    if (index === -1 || index + 1 >= process.argv.length) return null;
    return process.argv[index + 1];
}

async function main() {
    const buildId = argValue("--build");
    const dir = argValue("--out");
    const limit = argValue("--limit");
    if (!buildId || !dir) throw new Error("--build <id> and --out <dir> are required.");
    const databaseUrl = process.env.DATABASE_URL?.trim();
    if (!databaseUrl) throw new Error("DATABASE_URL is required.");
    const executorModule = await import("./lib/neon-executor");
    const { createNeonExecutor } = executorModule.default ?? executorModule;
    const executor = createNeonExecutor(databaseUrl);
    const result = await exportBuildVectors(executor, {
        buildId,
        dir: path.resolve(dir),
        maxRowsPerTable: limit ? Number(limit) : Infinity,
        log: (line) => process.stdout.write(`${line}\n`),
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.complete) {
        console.error(
            "NOTE: export incomplete (no manifest written) — re-run to resume, or a --limit was set.",
        );
        process.exitCode = 2;
    }
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entryPath === fileURLToPath(import.meta.url)) {
    main().catch((error) => {
        console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    });
}
