/** @vitest-environment node */
// Phase 9 GC gates: prune refuses active builds and unpromoted corpora, and
// never reaches legacy (NULL index_build_id) rows.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../scripts/db/lib/migration-runner";
import { listBuilds, pruneBuild } from "../../scripts/db/gc-index-builds.mjs";
import { MIGRATIONS_DIR, createTestDb, type TestDb } from "./helpers/pglite";

const CORPUS = "corpus-gc-test-v1";
const DATE = "1950-03-15";
const ARTICLE = "1950-03-15-0";

async function insertBuild(db: TestDb, id: string, status: string): Promise<void> {
    await db.pg.query(
        `INSERT INTO rag_index_builds
             (id, corpus_version, status, pipeline_version, embedding_model,
              text_embedding_input_version, image_embedding_input_version)
         VALUES ($1, $2, $3, 'p1', 'm1', 't1', 'i1')`,
        [id, CORPUS, status],
    );
}

async function insertChunk(db: TestDb, id: string, buildId: string | null): Promise<void> {
    await db.pg.query(
        `INSERT INTO article_chunks
             (id, index_build_id, article_id, chunk_index, chunk_text,
              embedding_model, embedding_input_version, embedding_input_hash)
         VALUES ($1, $2, $3, 0, 'chunk text', 'm1', 't1', 'hash')`,
        [id, buildId, ARTICLE],
    );
}

describe("gc-index-builds gates", () => {
    let db: TestDb;

    beforeAll(async () => {
        db = await createTestDb();
        await runMigrations(db.executor, { dir: MIGRATIONS_DIR });
        await db.pg.query(
            `INSERT INTO editions (date, publication_info, page_count, article_count)
             VALUES ($1, 'Test', 1, 1)`,
            [DATE],
        );
        await db.pg.query(
            `INSERT INTO articles (id, edition_date, position, category, headline, summary,
                                   full_text, body_plain, page, image_urls, image_captions)
             VALUES ($1, $2, 0, 'news', 'h', 's', 'f', 'b', 1, '[]', '[]')`,
            [ARTICLE, DATE],
        );
        await insertChunk(db, "legacy-chunk-0", null);
    }, 120_000);

    afterAll(async () => {
        await db.close();
    });

    it("refuses to prune when the corpus has no other active build", async () => {
        await insertBuild(db, "build-old", "validated");
        await insertChunk(db, "build-old:c0", "build-old");
        await expect(pruneBuild(db.executor, "build-old")).rejects.toThrow(/no OTHER active/);
    });

    it("refuses to prune the active build itself", async () => {
        await insertBuild(db, "build-live", "active");
        await expect(pruneBuild(db.executor, "build-live")).rejects.toThrow(/ACTIVE/);
    });

    it("prunes a superseded build once a replacement is active, sparing legacy rows", async () => {
        const result = await pruneBuild(db.executor, "build-old");
        expect(result.deletedChunks).toBe(1);
        expect(result.survivingActiveBuild).toBe("build-live");

        const { rows: builds } = await db.pg.query<{ id: string }>(
            "SELECT id FROM rag_index_builds ORDER BY id",
        );
        expect(builds.map((row) => row.id)).toEqual(["build-live"]);

        const { rows: legacy } = await db.pg.query<{ id: string }>(
            "SELECT id FROM article_chunks WHERE index_build_id IS NULL",
        );
        expect(legacy.map((row) => row.id)).toEqual(["legacy-chunk-0"]);

        await expect(pruneBuild(db.executor, "build-old")).rejects.toThrow(/Unknown/);
        expect(await listBuilds(db.executor)).toHaveLength(1);
    });
});
