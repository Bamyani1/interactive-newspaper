/** @vitest-environment node */
// The serving pointer: one row naming the build Ask serves, switched and
// switched back in one transaction.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../scripts/db/lib/migration-runner";
import {
  getServingPointer,
  switchBack,
  switchServingBuild,
} from "../../scripts/db/build-rag-index.mjs";
import { MIGRATIONS_DIR, createTestDb, type TestDb } from "./helpers/pglite";

const DATE = "1980-01-01";
const VECTOR = `[${Array(1024).fill(0.1).join(",")}]`;

async function insertArticles(db: TestDb, ids: string[]) {
  await db.pg.query(
    `INSERT INTO editions (date, publication_info, page_count, article_count)
     VALUES ($1, 'The Transcript', 1, $2) ON CONFLICT DO NOTHING`,
    [DATE, ids.length]
  );
  for (const [position, id] of ids.entries()) {
    await db.pg.query(
      `INSERT INTO articles (id, edition_date, position, category, headline, summary, full_text,
                             body_plain, byline, page, image_urls, image_caption, image_captions)
       VALUES ($1, $2, $3, 'news', $4, '', '<p>x</p>', 'x', '', 1, '[]', NULL, '[]')`,
      [id, DATE, position, `Headline ${id}`]
    );
  }
}

/** A build row plus one chunk per article; `unembedded` leaves that article's chunk without a vector. */
async function insertBuild(
  db: TestDb,
  id: string,
  options: { corpus?: string; status?: string; articles?: string[]; unembedded?: string[] } = {}
) {
  const corpus = options.corpus ?? "corpus-a";
  await db.pg.query("INSERT INTO corpus_versions (id) VALUES ($1) ON CONFLICT DO NOTHING", [
    corpus,
  ]);
  await db.pg.query(
    `INSERT INTO rag_index_builds
       (id, corpus_version, pipeline_version, embedding_model, image_embedding_model, embedding_dims,
        text_embedding_input_version, image_embedding_input_version, status)
     VALUES ($1, $2, 'p1', 'voyage-context-4', 'voyage-multimodal-3.5', 1024, 't1', 'i1', $3)`,
    [id, corpus, options.status ?? "validated"]
  );
  for (const article of options.articles ?? ["a1"]) {
    const embedded = !options.unembedded?.includes(article);
    await db.pg.query(
      `INSERT INTO article_chunks (id, index_build_id, article_id, chunk_index, chunk_text,
                                   embedding_input_hash, embedding_1024, embedding_model,
                                   embedding_input_version)
       VALUES ($1, $2, $3, 0, 'text', 'hash', $4::vector, $5, $6)`,
      [
        `${id}:${article}:0000`,
        id,
        article,
        embedded ? VECTOR : null,
        embedded ? "voyage-context-4" : null,
        embedded ? "t1" : null,
      ]
    );
  }
}

async function statuses(db: TestDb) {
  const { rows } = await db.pg.query<{ id: string; status: string }>(
    "SELECT id, status FROM rag_index_builds ORDER BY id"
  );
  return Object.fromEntries(rows.map((row) => [row.id, row.status]));
}

describe("serving pointer: switch and switch back", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
    await runMigrations(db.executor, { dir: MIGRATIONS_DIR });
    await insertArticles(db, ["a1", "a2"]);
    await insertBuild(db, "build-1", { articles: ["a1", "a2"] });
    await insertBuild(db, "build-2", { articles: ["a1", "a2"] });
    await insertBuild(db, "build-half", { articles: ["a1", "a2"], unembedded: ["a2"] });
    await insertBuild(db, "build-empty", { articles: [] });
    await insertBuild(db, "build-building", { status: "building" });
    await insertBuild(db, "build-other", { corpus: "corpus-b" });
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("has no pointer before the first switch, and switch-back refuses", async () => {
    expect(await getServingPointer(db.executor)).toBeNull();
    await expect(switchBack(db.executor)).rejects.toThrow(/no previous build/);
  });

  it("switches to a validated, fully embedded build", async () => {
    expect(await switchServingBuild(db.executor, "build-1")).toEqual({
      buildId: "build-1",
      corpusVersion: "corpus-a",
      previousBuildId: null,
    });
    expect(await getServingPointer(db.executor)).toMatchObject({
      indexBuildId: "build-1",
      corpusVersion: "corpus-a",
      previousBuildId: null,
      previousCorpusVersion: null,
    });
    expect((await statuses(db))["build-1"]).toBe("active");
  });

  it("switches within a corpus in one step: the old build goes back to validated", async () => {
    await switchServingBuild(db.executor, "build-2");
    expect(await getServingPointer(db.executor)).toMatchObject({
      indexBuildId: "build-2",
      corpusVersion: "corpus-a",
      previousBuildId: "build-1",
      previousCorpusVersion: "corpus-a",
    });
    expect(await statuses(db)).toMatchObject({ "build-1": "validated", "build-2": "active" });
  });

  it("refuses a build with chunks still lacking vectors, an empty build, and a building one", async () => {
    await expect(switchServingBuild(db.executor, "build-half")).rejects.toThrow(
      /1 chunk\(s\) without vectors/
    );
    await expect(switchServingBuild(db.executor, "build-empty")).rejects.toThrow(/no chunks/);
    await expect(switchServingBuild(db.executor, "build-building")).rejects.toThrow(/'building'/);
    await expect(switchServingBuild(db.executor, "build-missing")).rejects.toThrow(/Unknown/);
    expect((await getServingPointer(db.executor))?.indexBuildId).toBe("build-2");
    expect(await statuses(db)).toMatchObject({ "build-half": "validated", "build-2": "active" });
  });

  it("switches back, and back again", async () => {
    expect((await switchBack(db.executor)).buildId).toBe("build-1");
    expect(await statuses(db)).toMatchObject({ "build-1": "active", "build-2": "validated" });
    expect((await switchBack(db.executor)).buildId).toBe("build-2");
    expect(await getServingPointer(db.executor)).toMatchObject({
      indexBuildId: "build-2",
      previousBuildId: "build-1",
    });
  });

  it("switches across corpora without touching the other corpus's active build", async () => {
    await switchServingBuild(db.executor, "build-other");
    expect(await getServingPointer(db.executor)).toMatchObject({
      indexBuildId: "build-other",
      corpusVersion: "corpus-b",
      previousBuildId: "build-2",
      previousCorpusVersion: "corpus-a",
    });
    expect(await statuses(db)).toMatchObject({ "build-2": "active", "build-other": "active" });
    expect((await switchBack(db.executor)).buildId).toBe("build-2");
  });
});
