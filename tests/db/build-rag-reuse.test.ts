/** @vitest-environment node */
// --reuse: a new build copies vectors (and context lines) from the serving
// build for articles whose chunks are unchanged, so only new or changed
// articles cost embeddings.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../scripts/db/lib/migration-runner";
import { reuseFromBuild, switchServingBuild } from "../../scripts/db/build-rag-index.mjs";
import { MIGRATIONS_DIR, createTestDb, type TestDb } from "./helpers/pglite";

const DATE = "1980-01-01";
const vector = (n: number) => `[${[n, ...Array(1023).fill(0.1)].join(",")}]`;

interface Chunk {
  article: string;
  index: number;
  hash: string;
  embedded?: number;
  version?: string;
  context?: string;
}
interface Image {
  article: string;
  index: number;
  url: string;
  caption: string | null;
  embedded?: number;
}

async function insertBuild(
  db: TestDb,
  id: string,
  status: string,
  chunks: Chunk[],
  images: Image[] = [],
  textVersion = "t1"
) {
  await db.pg.query(
    `INSERT INTO rag_index_builds
       (id, corpus_version, pipeline_version, embedding_model, image_embedding_model, embedding_dims,
        text_embedding_input_version, image_embedding_input_version, status)
     VALUES ($1, 'corpus-a', 'p1', 'voyage-context-4', 'voyage-multimodal-3.5', 1024, $2, 'i1', $3)`,
    [id, textVersion, status]
  );
  for (const chunk of chunks) {
    const done = chunk.embedded !== undefined;
    await db.pg.query(
      `INSERT INTO article_chunks (id, index_build_id, article_id, chunk_index, chunk_text,
                                   embedding_input_hash, embedding_1024, embedding_model,
                                   embedding_input_version, context_text)
       VALUES ($1, $2, $3, $4, 'text', $5, $6::vector, $7, $8, $9)`,
      [
        `${id}:${chunk.article}:${chunk.index}`,
        id,
        chunk.article,
        chunk.index,
        chunk.hash,
        done ? vector(chunk.embedded!) : null,
        done ? "voyage-context-4" : null,
        done ? (chunk.version ?? "t1") : null,
        chunk.context ?? null,
      ]
    );
  }
  for (const image of images) {
    const done = image.embedded !== undefined;
    await db.pg.query(
      `INSERT INTO article_images (id, index_build_id, article_id, image_index, image_url, caption,
                                   embedding_1024, embedding_model, embedding_input_version,
                                   embedding_input_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7::vector, $8, $9, $10)`,
      [
        `${id}:${image.article}:img${image.index}`,
        id,
        image.article,
        image.index,
        image.url,
        image.caption,
        done ? vector(image.embedded!) : null,
        done ? "voyage-multimodal-3.5" : null,
        done ? "i1" : null,
        done ? `img-hash-${image.embedded}` : null,
      ]
    );
  }
}

async function chunkRows(db: TestDb, buildId: string) {
  const { rows } = await db.pg.query<{ key: string; first: number | null; context: string | null }>(
    `SELECT article_id || ':' || chunk_index AS key,
            (embedding_1024::real[])[1] AS first, context_text AS context
     FROM article_chunks WHERE index_build_id = $1 ORDER BY 1`,
    [buildId]
  );
  return Object.fromEntries(
    rows.map((row) => [row.key, { first: row.first, context: row.context }])
  );
}

async function imageRows(db: TestDb, buildId: string) {
  const { rows } = await db.pg.query<{ key: string; first: number | null; hash: string | null }>(
    `SELECT article_id || ':' || image_index AS key,
            (embedding_1024::real[])[1] AS first, embedding_input_hash AS hash
     FROM article_images WHERE index_build_id = $1 ORDER BY 1`,
    [buildId]
  );
  return Object.fromEntries(rows.map((row) => [row.key, { first: row.first, hash: row.hash }]));
}

describe("reuseFromBuild", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
    await runMigrations(db.executor, { dir: MIGRATIONS_DIR });
    await db.pg.query(
      `INSERT INTO editions (date, publication_info, page_count, article_count)
       VALUES ($1, 'The Transcript', 1, 6)`,
      [DATE]
    );
    for (const [position, id] of ["a1", "a2", "a3", "a4", "a5"].entries()) {
      await db.pg.query(
        `INSERT INTO articles (id, edition_date, position, category, headline, summary, full_text,
                               body_plain, byline, page, image_urls, image_caption, image_captions)
         VALUES ($1, $2, $3, 'news', 'h', '', '<p>x</p>', 'x', '', 1, '[]', NULL, '[]')`,
        [id, DATE, position]
      );
    }
    await db.pg.query("INSERT INTO corpus_versions (id) VALUES ('corpus-a')");

    // The serving build: everything embedded.
    await insertBuild(
      db,
      "build-old",
      "validated",
      [
        { article: "a1", index: 0, hash: "a1-0", embedded: 11, context: "ctx a1-0" },
        { article: "a1", index: 1, hash: "a1-1", embedded: 12, context: "ctx a1-1" },
        { article: "a2", index: 0, hash: "a2-0", embedded: 21 },
        { article: "a2", index: 1, hash: "a2-1", embedded: 22 },
        { article: "a4", index: 0, hash: "a4-0", embedded: 41 },
        { article: "a4", index: 1, hash: "a4-1", embedded: 42 },
        { article: "a5", index: 0, hash: "a5-0", embedded: 51, version: "t0" },
      ],
      [
        {
          article: "a1",
          index: 0,
          url: "https://r2/x/aaa.webp",
          caption: "Team photo",
          embedded: 101,
        },
        {
          article: "a1",
          index: 1,
          url: "https://r2/x/bbb.webp",
          caption: "Old caption",
          embedded: 102,
        },
        { article: "a2", index: 0, url: "https://r2/x/ccc.webp", caption: "Dean", embedded: 201 },
      ]
    );
    await switchServingBuild(db.executor, "build-old");

    // The new build: a1 unchanged, a2 has one changed chunk, a3 is new,
    // a4 lost a chunk, a5's old vector used an older input version.
    await insertBuild(
      db,
      "build-new",
      "building",
      [
        { article: "a1", index: 0, hash: "a1-0" },
        { article: "a1", index: 1, hash: "a1-1" },
        { article: "a2", index: 0, hash: "a2-0" },
        { article: "a2", index: 1, hash: "a2-1-changed" },
        { article: "a3", index: 0, hash: "a3-0" },
        { article: "a4", index: 0, hash: "a4-0" },
        { article: "a5", index: 0, hash: "a5-0" },
      ],
      [
        { article: "a1", index: 0, url: "https://r2/x/aaa.webp", caption: "Team photo" },
        { article: "a1", index: 1, url: "https://r2/x/bbb.webp", caption: "New caption" },
        { article: "a2", index: 0, url: "https://r2/x/ccc.webp", caption: "Dean" },
      ]
    );
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("copies whole unchanged articles from the serving build and leaves the rest to embed", async () => {
    expect(await reuseFromBuild(db.executor, "build-new")).toEqual({
      sourceBuildId: "build-old",
      articles: { reused: 1, toEmbed: 4 },
      chunks: { reused: 2, toEmbed: 5 },
      images: { reused: 1, toEmbed: 2 },
    });
    expect(await chunkRows(db, "build-new")).toEqual({
      "a1:0": { first: 11, context: "ctx a1-0" },
      "a1:1": { first: 12, context: "ctx a1-1" },
      "a2:0": { first: null, context: null },
      "a2:1": { first: null, context: null },
      "a3:0": { first: null, context: null },
      "a4:0": { first: null, context: null },
      "a5:0": { first: null, context: null },
    });
    expect(await imageRows(db, "build-new")).toEqual({
      "a1:0": { first: 101, hash: "img-hash-101" },
      "a1:1": { first: null, hash: null },
      "a2:0": { first: null, hash: null },
    });
  });

  it("is safe to run again: nothing more to copy", async () => {
    expect(await reuseFromBuild(db.executor, "build-new")).toMatchObject({
      chunks: { reused: 0, toEmbed: 5 },
      images: { reused: 0, toEmbed: 2 },
    });
  });

  it("refuses a target that is not building, a source with other models, or no source at all", async () => {
    await expect(reuseFromBuild(db.executor, "build-old")).rejects.toThrow(/out of 'building'/);
    await insertBuild(db, "build-other-version", "validated", [], [], "t9");
    await expect(
      reuseFromBuild(db.executor, "build-new", { fromBuildId: "build-other-version" })
    ).rejects.toThrow(/text_embedding_input_version/);
    await db.pg.query("DELETE FROM rag_serving_pointer");
    await expect(reuseFromBuild(db.executor, "build-new")).rejects.toThrow(/--from/);
  });
});
