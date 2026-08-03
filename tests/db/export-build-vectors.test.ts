/** @vitest-environment node */
// Round-trip: export-build-vectors output must be accepted verbatim by
// import-build-vectors (manifest hashes, counts, resumability).
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../scripts/db/lib/migration-runner";
import {
    createIndexBuild,
    embedBuildText,
    finalizeBuild,
    populateBuildRecords,
} from "../../scripts/db/build-rag-index.mjs";
import { exportBuildVectors } from "../../scripts/db/export-build-vectors.mjs";
import { importBuildVectors } from "../../scripts/db/import-build-vectors.mjs";
import {
    RAG_EMBEDDING_MODEL,
    RAG_IMAGE_EMBEDDING_INPUT_VERSION,
    RAG_PIPELINE_VERSION,
    RAG_TEXT_EMBEDDING_INPUT_VERSION,
} from "../../src/lib/rag-model-config";
import { MIGRATIONS_DIR, createTestDb, type TestDb } from "./helpers/pglite";
import type { PGlite } from "@electric-sql/pglite";

const CORPUS = "corpus-export-test-v1";
const DATE = "1950-04-01";
const ARTICLES = ["1950-04-01-0", "1950-04-01-1"];

async function seedFixture(pg: PGlite, prefix: string): Promise<void> {
    await pg.query(
        `INSERT INTO editions (date, publication_info, page_count, article_count)
         VALUES ($1, 'Test', 4, 2)`,
        [DATE],
    );
    await pg.query(`INSERT INTO issues (id, canonical_date) VALUES ($1, $2)`, [
        `issue-${prefix}`,
        DATE,
    ]);
    await pg.query(`INSERT INTO corpus_versions (id, description) VALUES ($1, 'test')`, [CORPUS]);
    for (const [position, articleId] of ARTICLES.entries()) {
        const body = Array.from(
            { length: 30 },
            (_, i) => `${articleId} sentence ${i} long enough to survive chunk triage easily.`,
        ).join(" ");
        await pg.query(
            `INSERT INTO articles
                 (id, edition_date, position, category, headline, summary, full_text,
                  body_plain, byline, page, image_urls, image_captions)
             VALUES ($1, $2, $3, 'news', $4, 's', $5, $6, 'W', 1, '[]', '[]')`,
            [articleId, DATE, position, `H${position}`, `<p>${body}</p>`, body],
        );
        const itemId = `${prefix}-item-${position}`;
        const revisionId = `${prefix}-crev-${position}`;
        await pg.query(
            `INSERT INTO content_items (id, issue_id, content_type, identity_key)
             VALUES ($1, $2, 'article', $3)`,
            [itemId, `issue-${prefix}`, `k-${articleId}`],
        );
        await pg.query(
            `INSERT INTO content_revisions
                 (id, content_item_id, revision_hash, category, headline, summary,
                  full_text, body_plain, byline, page)
             VALUES ($1, $2, $3, 'news', 'h', 's', 'f', 'b', 'by', 1)`,
            [revisionId, itemId, `rh-${articleId}`],
        );
        await pg.query(`UPDATE content_items SET active_revision_id = $2 WHERE id = $1`, [
            itemId,
            revisionId,
        ]);
        await pg.query(
            `INSERT INTO legacy_content_aliases
                 (legacy_id, content_item_id, content_revision_id, alias_kind)
             VALUES ($1, $2, $3, 'article')`,
            [articleId, itemId, revisionId],
        );
    }
}

describe("export-build-vectors round trip", () => {
    let source: TestDb;
    let target: TestDb;
    let dir: string;
    let buildId: string;

    beforeAll(async () => {
        source = await createTestDb();
        target = await createTestDb();
        await runMigrations(source.executor, { dir: MIGRATIONS_DIR });
        await runMigrations(target.executor, { dir: MIGRATIONS_DIR });
        await seedFixture(source.pg, "src");
        await seedFixture(target.pg, "tgt");
        buildId = await createIndexBuild(source.executor, {
            corpusVersion: CORPUS,
            pipelineVersion: RAG_PIPELINE_VERSION,
            embeddingModel: RAG_EMBEDDING_MODEL,
            textInputVersion: RAG_TEXT_EMBEDDING_INPUT_VERSION,
            imageInputVersion: RAG_IMAGE_EMBEDDING_INPUT_VERSION,
        });
        await populateBuildRecords(source.executor, buildId);
        await embedBuildText(source.executor, buildId, {
            embedFn: async (inputs: Array<{ text: string }>) =>
                inputs.map(() => Array.from({ length: 768 }, (_, i) => i / 1000)),
        });
        await finalizeBuild(source.executor, buildId);
        dir = mkdtempSync(path.join(tmpdir(), "export-rt-"));
    }, 120_000);

    afterAll(async () => {
        rmSync(dir, { recursive: true, force: true });
        await source.close();
        await target.close();
    });

    it("resumable export: a --limit pass writes no manifest, a full pass does", async () => {
        const partial = await exportBuildVectors(source.executor, {
            buildId,
            dir,
            maxRowsPerTable: 1,
        });
        expect(partial.complete).toBe(false);
        expect(() => readFileSync(path.join(dir, "manifest.json"))).toThrow();

        const full = await exportBuildVectors(source.executor, { buildId, dir });
        expect(full.complete).toBe(true);
        expect(full.onDisk.chunks).toBe(full.dbCounts.chunks);
        // The resumed run appended after the partial cursor — no duplicates.
        const ids = readFileSync(path.join(dir, "article_chunks.jsonl"), "utf8")
            .trimEnd()
            .split("\n")
            .map((line) => JSON.parse(line).id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("import accepts the export verbatim", async () => {
        const result = await importBuildVectors(target.executor, { dir });
        expect(result.buildId).toBe(buildId);
        expect(result.embedded.chunks).toBeGreaterThan(0);
    });
});
