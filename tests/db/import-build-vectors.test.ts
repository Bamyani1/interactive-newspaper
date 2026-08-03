/** @vitest-environment node */
// Round-trip test for scripts/db/import-build-vectors.mjs: a build produced
// in one database is exported (evacuation shape) and imported into a second
// database whose identity backfill minted DIFFERENT content-item ULIDs —
// proving hash verification, revision-id remapping, idempotency, and the
// manifest count contract.
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { runMigrations } from "../../scripts/db/lib/migration-runner";
import {
    createIndexBuild,
    embedBuildText,
    finalizeBuild,
    populateBuildRecords,
} from "../../scripts/db/build-rag-index.mjs";
import {
    importBuildVectors,
    verifyExportDir,
} from "../../scripts/db/import-build-vectors.mjs";
import {
    RAG_EMBEDDING_MODEL,
    RAG_IMAGE_EMBEDDING_INPUT_VERSION,
    RAG_PIPELINE_VERSION,
    RAG_TEXT_EMBEDDING_INPUT_VERSION,
} from "../../src/lib/rag-model-config";
import { MIGRATIONS_DIR, createTestDb, type TestDb } from "./helpers/pglite";

const CORPUS = "corpus-import-test-v1";
const DATE = "1950-03-15";
const ARTICLES = ["1950-03-15-0", "1950-03-15-1"];

const BUILD_OPTIONS = {
    corpusVersion: CORPUS,
    pipelineVersion: RAG_PIPELINE_VERSION,
    embeddingModel: RAG_EMBEDDING_MODEL,
    textInputVersion: RAG_TEXT_EMBEDDING_INPUT_VERSION,
    imageInputVersion: RAG_IMAGE_EMBEDDING_INPUT_VERSION,
} as const;

function longBody(seed: string): string {
    return Array.from(
        { length: 30 },
        (_, i) => `${seed} sentence ${i} carries enough tokens to survive chunk triage.`,
    ).join(" ");
}

/** Seed editions/articles plus the identity chain with per-database ULIDs. */
async function seedFixture(pg: PGlite, itemPrefix: string): Promise<void> {
    await pg.query(
        `INSERT INTO editions (date, publication_info, page_count, article_count)
         VALUES ($1, 'Test Transcript', 4, 2)`,
        [DATE],
    );
    await pg.query(`INSERT INTO issues (id, canonical_date) VALUES ($1, $2)`, [
        `issue-${itemPrefix}`,
        DATE,
    ]);
    await pg.query(`INSERT INTO corpus_versions (id, description) VALUES ($1, 'test corpus')`, [
        CORPUS,
    ]);
    for (const [position, articleId] of ARTICLES.entries()) {
        await pg.query(
            `INSERT INTO articles
                 (id, edition_date, position, category, headline, summary, full_text,
                  body_plain, byline, page, image_urls, image_captions)
             VALUES ($1, $2, $3, 'news', $4, 'summary', $5, $6, 'A Writer', 1, '[]', '[]')`,
            [
                articleId,
                DATE,
                position,
                `Headline ${position}`,
                `<p>${longBody(articleId)}</p>`,
                longBody(articleId),
            ],
        );
        const itemId = `${itemPrefix}-item-${position}`;
        const revisionId = `${itemPrefix}-crev-${position}`;
        await pg.query(
            `INSERT INTO content_items (id, issue_id, content_type, identity_key)
             VALUES ($1, $2, 'article', $3)`,
            [itemId, `issue-${itemPrefix}`, `key-${articleId}`],
        );
        await pg.query(
            `INSERT INTO content_revisions
                 (id, content_item_id, revision_hash, category, headline, summary,
                  full_text, body_plain, byline, page)
             VALUES ($1, $2, $3, 'news', 'h', 's', 'f', 'b', 'by', 1)`,
            [revisionId, itemId, `hash-${articleId}`],
        );
        await pg.query(
            `UPDATE content_items SET active_revision_id = $2 WHERE id = $1`,
            [itemId, revisionId],
        );
        await pg.query(
            `INSERT INTO legacy_content_aliases
                 (legacy_id, content_item_id, content_revision_id, alias_kind)
             VALUES ($1, $2, $3, 'article')`,
            [articleId, itemId, revisionId],
        );
    }
}

function exportBuild(dir: string, buildRow: unknown, chunkRows: unknown[]): void {
    const files: Record<string, { sha256: string; rows: number; bytes: number }> = {};
    const write = (name: string, content: string, rows: number) => {
        writeFileSync(path.join(dir, name), content);
        files[name] = {
            sha256: createHash("sha256").update(Buffer.from(content)).digest("hex"),
            rows,
            bytes: Buffer.byteLength(content),
        };
    };
    write("rag_index_builds.json", `${JSON.stringify(buildRow, null, 2)}\n`, 1);
    write(
        "article_chunks.jsonl",
        `${chunkRows.map((row) => JSON.stringify(row)).join("\n")}\n`,
        chunkRows.length,
    );
    writeFileSync(
        path.join(dir, "manifest.json"),
        `${JSON.stringify(
            {
                buildId: (buildRow as { id: string }).id,
                files,
                dbCounts: { chunks: chunkRows.length, images: 0 },
            },
            null,
            2,
        )}\n`,
    );
}

describe("import-build-vectors round trip", () => {
    let source: TestDb;
    let target: TestDb;
    let exportDir: string;
    let buildId: string;

    beforeAll(async () => {
        source = await createTestDb();
        target = await createTestDb();
        await runMigrations(source.executor, { dir: MIGRATIONS_DIR });
        await runMigrations(target.executor, { dir: MIGRATIONS_DIR });
        await seedFixture(source.pg, "src");
        await seedFixture(target.pg, "tgt");

        buildId = await createIndexBuild(source.executor, BUILD_OPTIONS);
        await populateBuildRecords(source.executor, buildId);
        await embedBuildText(source.executor, buildId, {
            embedFn: async (inputs: Array<{ text: string }>) =>
                inputs.map(() => Array.from({ length: 768 }, (_, i) => i / 1000)),
        });
        await finalizeBuild(source.executor, buildId);
        // Source is ACTIVE at export time; the import must land it 'validated'.
        await source.pg.query(
            "UPDATE rag_index_builds SET status = 'active', activated_at = now() WHERE id = $1",
            [buildId],
        );

        const { rows: buildRows } = await source.pg.query(
            "SELECT * FROM rag_index_builds WHERE id = $1",
            [buildId],
        );
        const { rows: chunkRows } = await source.pg.query(
            `SELECT id, index_build_id, article_id, chunk_index, chunk_text,
                    embedding::text AS embedding, embedding_model,
                    embedding_input_version, embedding_input_hash, content_revision_id
             FROM article_chunks
             WHERE index_build_id = $1 AND embedding IS NOT NULL ORDER BY id`,
            [buildId],
        );
        expect(chunkRows.length).toBeGreaterThan(0);
        exportDir = mkdtempSync(path.join(tmpdir(), "vector-export-"));
        exportBuild(exportDir, buildRows[0], chunkRows);
    }, 120_000);

    afterAll(async () => {
        rmSync(exportDir, { recursive: true, force: true });
        await source.close();
        await target.close();
    });

    it("imports with hash verification, revision remap, and exact counts", async () => {
        const result = await importBuildVectors(target.executor, { dir: exportDir });
        expect(result.buildId).toBe(buildId);
        expect(result.insertedChunks).toBe(result.embedded.chunks);

        // Activation never travels: an active source lands as 'validated'.
        const { rows: buildRows } = await target.pg.query<{
            status: string;
            activated_at: string | null;
        }>("SELECT status, activated_at FROM rag_index_builds WHERE id = $1", [buildId]);
        expect(buildRows[0].status).toBe("validated");
        expect(buildRows[0].activated_at).toBeNull();

        // Every imported row must point at the TARGET's revision ids, never
        // the source's (ULID-derived ids are not portable across backfills).
        const { rows } = await target.pg.query<{ content_revision_id: string }>(
            "SELECT DISTINCT content_revision_id FROM article_chunks WHERE index_build_id = $1",
            [buildId],
        );
        for (const row of rows) {
            expect(row.content_revision_id).toMatch(/^tgt-crev-/);
        }
    });

    it("is idempotent: a second import inserts nothing and still verifies", async () => {
        const again = await importBuildVectors(target.executor, { dir: exportDir });
        expect(again.insertedChunks).toBe(0);
        expect(again.embedded.chunks).toBeGreaterThan(0);
    });

    it("refuses a tampered export file", async () => {
        const chunkPath = path.join(exportDir, "article_chunks.jsonl");
        const original = readFileSync(chunkPath, "utf8");
        writeFileSync(chunkPath, original.replace("sentence 0", "sentence tampered"));
        expect(() => verifyExportDir(exportDir)).toThrow(/hash verification/);
        writeFileSync(chunkPath, original);
    });

    it("refuses an unregistered corpus", async () => {
        const bare = await createTestDb();
        await runMigrations(bare.executor, { dir: MIGRATIONS_DIR });
        await seedFixture(bare.pg, "bare");
        await bare.pg.query("DELETE FROM corpus_versions WHERE id = $1", [CORPUS]);
        await expect(
            importBuildVectors(bare.executor, { dir: exportDir }),
        ).rejects.toThrow(/not registered/);
        await bare.close();
    });
});
