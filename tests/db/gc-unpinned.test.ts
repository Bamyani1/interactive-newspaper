/** @vitest-environment node */
// gc --prune-unpinned keeps the serving pointer's current and previous builds
// (and anything building or active) and deletes every other build.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../scripts/db/lib/migration-runner";
import { listBuilds, pruneUnpinned } from "../../scripts/db/gc-index-builds.mjs";
import { MIGRATIONS_DIR, createTestDb, type TestDb } from "./helpers/pglite";

const DATE = "1980-01-01";

async function insertBuild(db: TestDb, id: string, status: string, corpus = "corpus-a") {
  await db.pg.query("INSERT INTO corpus_versions (id) VALUES ($1) ON CONFLICT DO NOTHING", [
    corpus,
  ]);
  await db.pg.query(
    `INSERT INTO rag_index_builds
       (id, corpus_version, pipeline_version, embedding_model, image_embedding_model, embedding_dims,
        text_embedding_input_version, image_embedding_input_version, status)
     VALUES ($1, $2, 'p1', 'voyage-context-4', 'voyage-multimodal-3.5', 1024, 't1', 'i1', $3)`,
    [id, corpus, status]
  );
  await db.pg.query(
    `INSERT INTO article_chunks (id, index_build_id, article_id, chunk_index, chunk_text, embedding_input_hash)
     VALUES ($1, $2, 'a1', 0, 'text', 'hash')`,
    [`${id}:a1:0`, id]
  );
  await db.pg.query(
    `INSERT INTO article_images (id, index_build_id, article_id, image_index, image_url)
     VALUES ($1, $2, 'a1', 0, 'https://r2/x/a.webp')`,
    [`${id}:a1:img0`, id]
  );
}

describe("pruneUnpinned", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
    await runMigrations(db.executor, { dir: MIGRATIONS_DIR });
    await db.pg.query(
      `INSERT INTO editions (date, publication_info, page_count, article_count) VALUES ($1, 'T', 1, 1)`,
      [DATE]
    );
    await db.pg.query(
      `INSERT INTO articles (id, edition_date, position, category, headline, summary, full_text,
                             body_plain, byline, page, image_urls, image_caption, image_captions)
       VALUES ('a1', $1, 0, 'news', 'h', '', '<p>x</p>', 'x', '', 1, '[]', NULL, '[]')`,
      [DATE]
    );
    await insertBuild(db, "build-1-old", "validated");
    await insertBuild(db, "build-2-previous", "validated");
    await insertBuild(db, "build-3-current", "active");
    await insertBuild(db, "build-4-building", "building");
    await insertBuild(db, "build-5-failed", "failed");
    await insertBuild(db, "build-6-other-active", "active", "corpus-b");
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("refuses without a serving pointer", async () => {
    await expect(pruneUnpinned(db.executor)).rejects.toThrow(/serving pointer/);
  });

  it("marks pinned builds in --list", async () => {
    await db.pg.query(
      `INSERT INTO rag_serving_pointer (id, index_build_id, corpus_version, previous_build_id, previous_corpus_version)
       VALUES (1, 'build-3-current', 'corpus-a', 'build-2-previous', 'corpus-a')`
    );
    const pinned = Object.fromEntries(
      (await listBuilds(db.executor)).map((row) => [row.id, row.pinned])
    );
    expect(pinned).toMatchObject({
      "build-1-old": null,
      "build-2-previous": "previous",
      "build-3-current": "current",
    });
  });

  it("deletes every unpinned finished build and keeps current, previous, building and active ones", async () => {
    const result = await pruneUnpinned(db.executor);
    expect(result.deleted).toEqual([
      { buildId: "build-1-old", deletedChunks: 1, deletedImages: 1 },
      { buildId: "build-5-failed", deletedChunks: 1, deletedImages: 1 },
    ]);
    expect(result.kept.sort()).toEqual([
      "build-2-previous",
      "build-3-current",
      "build-4-building",
      "build-6-other-active",
    ]);
    const { rows } = await db.pg.query<{ index_build_id: string }>(
      "SELECT DISTINCT index_build_id FROM article_chunks ORDER BY 1"
    );
    expect(rows.map((row) => row.index_build_id)).toEqual([
      "build-2-previous",
      "build-3-current",
      "build-4-building",
      "build-6-other-active",
    ]);
  });
});
