/** @vitest-environment node */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import sharp from "sharp";
import { runMigrations } from "../../scripts/db/lib/migration-runner";
import {
  activateBuild,
  contextualizeBuildChunks,
  createIndexBuild,
  dryRunReport,
  embedBuildImages,
  embedBuildText,
  finalizeBuild,
  fitImageForVoyage,
  populateBuildRecords,
  registerCorpus,
  rollbackActivation,
  sniffImageMime,
} from "../../scripts/db/build-rag-index.mjs";
import { buildArticleChunkRecords } from "../../src/lib/article-chunking";
import {
  buildChunkHeader,
  buildEmbeddingInput,
  type ChunkedDocument,
} from "../../src/lib/embeddings";
import { computeCostUsd, computeEmbeddingCostUsd } from "../../src/lib/cost-tracker";
import {
  RAG_EMBEDDING_DIMS,
  RAG_EMBEDDING_MODEL,
  RAG_GENERATION_MODEL,
  RAG_IMAGE_EMBEDDING_INPUT_VERSION,
  RAG_IMAGE_EMBEDDING_MODEL,
  RAG_PIPELINE_VERSION,
  RAG_TEXT_EMBEDDING_INPUT_VERSION,
} from "../../src/lib/rag-model-config";
import { MIGRATIONS_DIR, createTestDb, type TestDb } from "./helpers/pglite";

const DATE = "1954-05-05";
const CORPUS = "corpus-test-v1";
const A1 = `${DATE}-0`; // long body -> multiple chunks, 2 images, aliased
const A2 = `${DATE}-1`; // long body -> multiple chunks, no images, aliased
const A3 = `${DATE}-2`; // short body -> 1 chunk, NO alias
const HEX64 = "ab".repeat(32);
const GOOD_IMAGE_URL = `https://cdn.example.org/${DATE}/images/${HEX64}.webp`;
const MISSING_IMAGE_URL = `https://archive.example.org/${DATE}/images/court-scene.webp`;
const CREV1 = "crev-fixture-a1";
const CREV2 = "crev-fixture-a2";

const BUILD_OPTIONS = {
  corpusVersion: CORPUS,
  pipelineVersion: RAG_PIPELINE_VERSION,
  embeddingModel: RAG_EMBEDDING_MODEL,
  imageEmbeddingModel: RAG_IMAGE_EMBEDDING_MODEL,
  embeddingDims: RAG_EMBEDDING_DIMS,
  textInputVersion: RAG_TEXT_EMBEDDING_INPUT_VERSION,
  imageInputVersion: RAG_IMAGE_EMBEDDING_INPUT_VERSION,
} as const;

function longBody(seed: string, sentences: number): string {
  const parts: string[] = [];
  for (let index = 0; index < sentences; index += 1) {
    parts.push(
      `${seed} dispatch number ${index} recounts the week of campus happenings in ` +
        "careful and deliberate detail for the archive."
    );
  }
  return parts.join(" ");
}

interface FixtureArticle {
  id: string;
  headline: string;
  byline: string | null;
  body_plain: string;
  edition_date: string;
  category: string;
  summary: string | null;
  image_urls: string[];
  image_caption: string | null;
  image_captions: (string | null)[];
}

const FIXTURE_ARTICLES: FixtureArticle[] = [
  {
    id: A1,
    headline: "Moot Court Marathon Fills Gray Chapel",
    byline: "By Jack Morris",
    body_plain: longBody("The moot court", 80),
    edition_date: DATE,
    category: "News",
    summary: "Law society stages an all-day mock trial marathon.",
    image_urls: [GOOD_IMAGE_URL, MISSING_IMAGE_URL],
    image_caption: "The moot court panel hears opening arguments",
    image_captions: ["The moot court panel hears opening arguments", null],
  },
  {
    id: A2,
    headline: "Glee Club Plans Spring Tour",
    byline: null,
    body_plain: longBody("The glee club", 60),
    edition_date: DATE,
    category: "Campus",
    summary: "Six Ohio cities are on the spring itinerary.",
    image_urls: [],
    image_caption: null,
    image_captions: [],
  },
  {
    id: A3,
    headline: "Weather Delays Baseball Opener",
    byline: "By Ruth Adams",
    body_plain: "Rain postponed the baseball opener until Thursday afternoon.",
    edition_date: DATE,
    category: "Sports",
    summary: null,
    image_urls: [],
    image_caption: null,
    image_captions: [],
  },
];

function expectedChunkRecords() {
  return FIXTURE_ARTICLES.map((article) => ({
    article,
    records: buildArticleChunkRecords({
      id: article.id,
      headline: article.headline,
      byline: article.byline,
      body_plain: article.body_plain,
      edition_date: article.edition_date,
      category: article.category,
      summary: article.summary,
    }),
  }));
}

const TOTAL_CHUNKS = expectedChunkRecords().reduce((sum, e) => sum + e.records.length, 0);

function deterministicVector(text: string): number[] {
  let acc = 7;
  for (let index = 0; index < text.length; index += 1) {
    acc = (acc * 31 + text.charCodeAt(index)) % 997;
  }
  return Array.from({ length: RAG_EMBEDDING_DIMS }, (_, i) => ((acc + i) % 100) / 100);
}

interface FakeEmbedChunksFn {
  (documents: ChunkedDocument[]): Promise<number[][][]>;
  calls: number;
  documents: ChunkedDocument[];
}

function makeEmbedChunksFn(): FakeEmbedChunksFn {
  const fn = (async (documents: ChunkedDocument[]) => {
    fn.calls += 1;
    fn.documents.push(...documents);
    return documents.map((doc) => doc.chunks.map((chunk) => deterministicVector(chunk)));
  }) as FakeEmbedChunksFn;
  fn.calls = 0;
  fn.documents = [];
  return fn;
}

interface FakeEmbedFn {
  (inputs: Array<{ text: string }>): Promise<number[][]>;
  calls: number;
}

function makeEmbedFn(): FakeEmbedFn {
  const fn = (async (inputs: Array<{ text: string }>) => {
    fn.calls += 1;
    return inputs.map((input) => deterministicVector(input.text));
  }) as FakeEmbedFn;
  fn.calls = 0;
  return fn;
}

/** A real (tiny) webp: the build decodes images to check their size. */
async function webpBuffer(): Promise<Buffer> {
  return sharp({ create: { width: 8, height: 8, channels: 3, background: "#777" } })
    .webp()
    .toBuffer();
}

/** Serves the object as a two-part async iterable to exercise streaming. */
function streamOf(buffer: Buffer): AsyncIterable<Buffer> {
  return (async function* () {
    yield buffer.subarray(0, 10);
    yield buffer.subarray(10);
  })();
}

// The build script cannot see photo sizes before reading them, so it prices
// each photo at this estimate (ESTIMATED_PIXELS_PER_IMAGE in the script).
const ESTIMATED_PIXELS = 1_500_000;

async function insertFixture(pg: PGlite): Promise<void> {
  await pg.query(
    `INSERT INTO editions (date, publication_info, page_count, article_count)
         VALUES ($1, 'Ohio Wesleyan Transcript, Volume 86, Number 27', 4, 3)`,
    [DATE]
  );
  for (const [position, article] of FIXTURE_ARTICLES.entries()) {
    await pg.query(
      `INSERT INTO articles
                 (id, edition_date, position, category, headline, summary, full_text,
                  body_plain, byline, page, image_urls, image_caption, image_captions)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        article.id,
        article.edition_date,
        position,
        article.category,
        article.headline,
        article.summary ?? "",
        `<p>${article.body_plain}</p>`,
        article.body_plain,
        article.byline,
        1,
        JSON.stringify(article.image_urls),
        article.image_caption,
        JSON.stringify(article.image_captions),
      ]
    );
  }

  // backfill-identities-style alias setup, inserted directly: A1 and A2 get
  // legacy_content_aliases rows pointing at content revisions; A3 does not.
  await pg.query(`INSERT INTO issues (id, canonical_date) VALUES ('issue-fixture-1', $1)`, [DATE]);
  for (const [item, revision, legacyId] of [
    ["item-fixture-a1", CREV1, A1],
    ["item-fixture-a2", CREV2, A2],
  ] as const) {
    await pg.query(
      `INSERT INTO content_items (id, issue_id, content_type, identity_key)
             VALUES ($1, 'issue-fixture-1', 'article', $2)`,
      [item, `key-${item}`]
    );
    await pg.query(
      `INSERT INTO content_revisions (id, content_item_id, revision_hash)
             VALUES ($1, $2, $3)`,
      [revision, item, `hash-${item}`]
    );
    await pg.query(
      `INSERT INTO legacy_content_aliases
                 (legacy_id, content_item_id, content_revision_id, alias_kind)
             VALUES ($1, $2, $3, 'article')`,
      [legacyId, item, revision]
    );
  }
}

describe("build-rag-index against PGlite", () => {
  let db: TestDb;
  let buildA: string;

  beforeAll(async () => {
    db = await createTestDb();
    await runMigrations(db.executor, { dir: MIGRATIONS_DIR });
    await insertFixture(db.pg);
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("creates a 'building' build with a build- prefixed ULID id", async () => {
    buildA = await createIndexBuild(db.executor, BUILD_OPTIONS);
    expect(buildA).toMatch(/^build-[0-9A-HJKMNP-TV-Z]{26}$/);
    const { rows } = await db.pg.query<{ status: string; corpus_version: string }>(
      "SELECT status, corpus_version FROM rag_index_builds WHERE id = $1",
      [buildA]
    );
    expect(rows[0]).toEqual({ status: "building", corpus_version: CORPUS });
  });

  it("createIndexBuild registers its corpus", async () => {
    const { rows } = await db.pg.query<{ id: string }>(
      "SELECT id FROM corpus_versions WHERE id = $1",
      [CORPUS]
    );
    expect(rows).toEqual([{ id: CORPUS }]);
  });

  it("registerCorpus inserts once and is idempotent", async () => {
    expect(await registerCorpus(db.executor, "corpus-register-test")).toEqual({
      id: "corpus-register-test",
      inserted: true,
    });
    expect(await registerCorpus(db.executor, "corpus-register-test")).toEqual({
      id: "corpus-register-test",
      inserted: false,
    });
    const { rows } = await db.pg.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM corpus_versions WHERE id = 'corpus-register-test'"
    );
    expect(rows[0].n).toBe(1);
  });

  it("populates build-scoped records with alias-derived content_revision_id", async () => {
    const counts = await populateBuildRecords(db.executor, buildA);
    expect(counts).toEqual({ articles: 3, chunks: TOTAL_CHUNKS, images: 2 });
    expect(TOTAL_CHUNKS).toBeGreaterThanOrEqual(4); // A1 and A2 chunk multiply

    const { rows: chunks } = await db.pg.query<{
      id: string;
      article_id: string;
      content_revision_id: string | null;
      embedding_input_hash: string;
    }>(
      `SELECT id, article_id, content_revision_id, embedding_input_hash
             FROM article_chunks WHERE index_build_id = $1 ORDER BY id`,
      [buildA]
    );
    expect(chunks).toHaveLength(TOTAL_CHUNKS);
    for (const chunk of chunks) {
      expect(chunk.id.startsWith(`${buildA}:`)).toBe(true);
      expect(chunk.embedding_input_hash).toMatch(/^[a-f0-9]{64}$/);
      const expectedRevision =
        chunk.article_id === A1 ? CREV1 : chunk.article_id === A2 ? CREV2 : null;
      expect(chunk.content_revision_id).toBe(expectedRevision);
    }
    const a1Records = expectedChunkRecords()[0].records;
    expect(a1Records.length).toBeGreaterThan(1);
    expect(chunks.map((c) => c.id).slice(0, a1Records.length)).toEqual(
      a1Records.map((record) => `${buildA}:${record.id}`)
    );

    const { rows: images } = await db.pg.query<{
      id: string;
      caption: string | null;
      content_revision_id: string | null;
      embedding_input_hash: string | null;
    }>(
      `SELECT id, caption, content_revision_id, embedding_input_hash
             FROM article_images WHERE index_build_id = $1 ORDER BY id`,
      [buildA]
    );
    expect(images.map((image) => image.id)).toEqual([
      `${buildA}:${A1}:image:000`,
      `${buildA}:${A1}:image:001`,
    ]);
    expect(images[0].caption).toBe("The moot court panel hears opening arguments");
    expect(images[1].caption).toBeNull();
    // The image input hash needs the object BYTES; it stays NULL until embed.
    expect(images.map((image) => image.embedding_input_hash)).toEqual([null, null]);
    expect(images.map((image) => image.content_revision_id)).toEqual([CREV1, CREV1]);

    // Resumable: a second populate converges without duplicating rows.
    const again = await populateBuildRecords(db.executor, buildA);
    expect(again).toEqual(counts);
    const { rows: recount } = await db.pg.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM article_chunks WHERE index_build_id = $1",
      [buildA]
    );
    expect(recount[0].n).toBe(TOTAL_CHUNKS);
  });

  it("embeds every text chunk with cost-tracker pricing", async () => {
    const embedChunksFn = makeEmbedChunksFn();
    const result = await embedBuildText(db.executor, buildA, { embedChunksFn });
    expect(result.planned).toBe(TOTAL_CHUNKS);
    expect(result.embedded).toBe(TOTAL_CHUNKS);
    expect(result.skipped).toBe(0);
    expect(result.failed).toEqual([]);
    expect(result.textTokens).toBeGreaterThan(0);
    expect(result.costUsd).toBeCloseTo(
      computeEmbeddingCostUsd(RAG_EMBEDDING_MODEL, { total_tokens: result.textTokens }),
      12
    );
    expect(embedChunksFn.calls).toBe(1); // 3 articles fit one batch

    // One document per article, led by its header, chunks in order.
    expect(embedChunksFn.documents).toEqual(
      expectedChunkRecords().map(({ article, records }) => ({
        header: buildChunkHeader(article),
        chunks: records.map((record) => record.embeddingInput.text),
      }))
    );

    const { rows } = await db.pg.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM article_chunks
             WHERE index_build_id = $1 AND embedding_1024 IS NOT NULL
               AND embedding_model = $2 AND embedding_input_version = $3`,
      [buildA, RAG_EMBEDDING_MODEL, RAG_TEXT_EMBEDDING_INPUT_VERSION]
    );
    expect(rows[0].n).toBe(TOTAL_CHUNKS);
  });

  it("exact-hash resumability: a second text pass never calls the model", async () => {
    const embedChunksFn = makeEmbedChunksFn();
    const result = await embedBuildText(db.executor, buildA, { embedChunksFn });
    expect(result.planned).toBe(0);
    expect(result.embedded).toBe(0);
    expect(result.skipped).toBe(TOTAL_CHUNKS);
    expect(result.failed).toEqual([]);
    expect(embedChunksFn.calls).toBe(0);
  });

  it("streams images one at a time and isolates per-item failures", async () => {
    const fetchedKeys: string[] = [];
    const goodKey = `ocr-assets/${HEX64}.webp`;
    const fetchObject = async (key: string) => {
      fetchedKeys.push(key);
      if (key === goodKey) return streamOf(await webpBuffer());
      throw new Error(`NoSuchKey: ${key}`);
    };
    const embedFn = makeEmbedFn();
    const result = await embedBuildImages(db.executor, buildA, { embedFn, fetchObject });

    expect(result.images).toBe(2);
    expect(result.planned).toBe(2);
    expect(result.embedded).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.failed).toEqual([
      {
        id: `${buildA}:${A1}:image:001`,
        reason: `NoSuchKey: ${DATE}/images/court-scene.webp`,
      },
    ]);
    expect(fetchedKeys).toEqual([goodKey, `${DATE}/images/court-scene.webp`]);

    // Expected cost from the exact multimodal input the script builds.
    const caption = "The moot court panel hears opening arguments";
    const imageInput = buildEmbeddingInput({
      headline: FIXTURE_ARTICLES[0].headline,
      byline: FIXTURE_ARTICLES[0].byline,
      body_plain: `Image caption: ${caption}`,
      edition_date: DATE,
      category: FIXTURE_ARTICLES[0].category,
      summary: FIXTURE_ARTICLES[0].summary,
      image_caption: caption,
    });
    const imageTokens = Math.ceil(imageInput.text.length / 4);
    expect(result.costUsd).toBeCloseTo(
      computeEmbeddingCostUsd(RAG_IMAGE_EMBEDDING_MODEL, {
        total_tokens: imageTokens,
        text_tokens: imageTokens,
        image_pixels: ESTIMATED_PIXELS,
      }),
      12
    );

    const { rows } = await db.pg.query<{
      id: string;
      has_embedding: boolean;
      embedding_input_hash: string | null;
    }>(
      `SELECT id, (embedding_1024 IS NOT NULL) AS has_embedding, embedding_input_hash
             FROM article_images WHERE index_build_id = $1 ORDER BY id`,
      [buildA]
    );
    expect(rows[0].has_embedding).toBe(true);
    expect(rows[0].embedding_input_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(rows[1].has_embedding).toBe(false);
    expect(rows[1].embedding_input_hash).toBeNull();

    // Second pass: the embedded image is skipped without refetching; only
    // the still-missing object is retried (and fails again, loop intact).
    fetchedKeys.length = 0;
    const second = await embedBuildImages(db.executor, buildA, { embedFn, fetchObject });
    expect(second.skipped).toBe(1);
    expect(second.planned).toBe(1);
    expect(second.embedded).toBe(0);
    expect(second.failed).toHaveLength(1);
    expect(fetchedKeys).toEqual([`${DATE}/images/court-scene.webp`]);
  });

  it("finalizes to 'validated' when text coverage is complete, despite image failures", async () => {
    const result = await finalizeBuild(db.executor, buildA);
    expect(result.status).toBe("validated");
    expect(result.pendingChunks).toBe(0);
    expect(result.pendingImages).toBe(1); // the missing R2 object — does not fail the build

    const { rows } = await db.pg.query<{
      status: string;
      validated_at: string | null;
      failure_reason: string | null;
    }>("SELECT status, validated_at, failure_reason FROM rag_index_builds WHERE id = $1", [buildA]);
    expect(rows[0].status).toBe("validated");
    expect(rows[0].validated_at).not.toBeNull();
    expect(rows[0].failure_reason).toBeNull();
  });

  it("no-force invariant: finalized builds are immutable; a rebuild is a NEW id", async () => {
    await expect(finalizeBuild(db.executor, buildA)).rejects.toThrow(/immutable/);
    await expect(
      embedBuildText(db.executor, buildA, { embedChunksFn: makeEmbedChunksFn() })
    ).rejects.toThrow(/immutable/);
    await expect(populateBuildRecords(db.executor, buildA)).rejects.toThrow(/immutable/);

    const rebuild = await createIndexBuild(db.executor, BUILD_OPTIONS);
    expect(rebuild).not.toBe(buildA);
    expect(rebuild).toMatch(/^build-/);
  });

  it("activates a validated build, enforces single-active, and rolls back", async () => {
    await expect(activateBuild(db.executor, "build-missing")).rejects.toThrow(/Unknown/);

    const activated = await activateBuild(db.executor, buildA);
    expect(activated.status).toBe("active");
    const { rows } = await db.pg.query<{ status: string; activated_at: string | null }>(
      "SELECT status, activated_at FROM rag_index_builds WHERE id = $1",
      [buildA]
    );
    expect(rows[0].status).toBe("active");
    expect(rows[0].activated_at).not.toBeNull();

    // A second validated build of the same corpus cannot activate on top.
    const rival = await createIndexBuild(db.executor, BUILD_OPTIONS);
    await populateBuildRecords(db.executor, rival);
    await embedBuildText(db.executor, rival, { embedChunksFn: makeEmbedChunksFn() });
    await finalizeBuild(db.executor, rival);
    await expect(activateBuild(db.executor, rival)).rejects.toThrow(/already has active build/);

    // Rollback demotes to validated; the rival can then take over.
    const demoted = await rollbackActivation(db.executor, buildA);
    expect(demoted.status).toBe("validated");
    const swapped = await activateBuild(db.executor, rival);
    expect(swapped.status).toBe("active");

    // 'building' builds can never activate; only 'active' rolls back.
    const fresh = await createIndexBuild(db.executor, BUILD_OPTIONS);
    await expect(activateBuild(db.executor, fresh)).rejects.toThrow(/only 'validated'/);
    await expect(rollbackActivation(db.executor, buildA)).rejects.toThrow(/only 'active'/);

    // Leave no active build behind so later tests see the same world as before.
    await rollbackActivation(db.executor, rival);
  });

  it("writes Claude context lines once and indexes them for keyword search", async () => {
    const build = await createIndexBuild(db.executor, BUILD_OPTIONS);
    await populateBuildRecords(db.executor, build);

    interface ContextRequest {
      custom_id: string;
      params: Record<string, unknown>;
    }
    const usage = { input_tokens: 1_000, output_tokens: 40 };
    const sent: ContextRequest[] = [];
    let blankFirst = true;
    const runBatch = async (requests: ContextRequest[]) => {
      sent.push(...requests);
      const results = requests.map((request, index) => ({
        custom_id: request.custom_id,
        text: blankFirst && index === 0 ? "  " : "A courtroom contest staged by students.",
        usage,
      }));
      blankFirst = false;
      return results;
    };

    const first = await contextualizeBuildChunks(db.executor, build, { runBatch });
    expect(first.planned).toBe(TOTAL_CHUNKS);
    expect(first.written).toBe(TOTAL_CHUNKS - 1);
    expect(first.failed).toHaveLength(1);
    // Batch API: half the online price, and a blank answer was still billed.
    expect(first.costUsd).toBeCloseTo(
      computeCostUsd(RAG_GENERATION_MODEL, usage) * 0.5 * TOTAL_CHUNKS,
      12
    );
    for (const request of sent) {
      expect(request.custom_id).toMatch(/^[a-f0-9]{48}$/);
      expect(request.params.model).toBe(RAG_GENERATION_MODEL);
    }

    // The trigger indexes the line with the chunk.
    const { rows } = await db.pg.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM article_chunks
             WHERE index_build_id = $1
               AND search_vector @@ plainto_tsquery('english', 'courtroom contest')`,
      [build]
    );
    expect(rows[0].n).toBe(TOTAL_CHUNKS - 1);

    // A re-run sends only the chunk still without a line.
    sent.length = 0;
    const second = await contextualizeBuildChunks(db.executor, build, { runBatch });
    expect(sent).toHaveLength(1);
    expect(second).toMatchObject({ planned: 1, written: 1, failed: [] });

    await expect(contextualizeBuildChunks(db.executor, buildA, { runBatch })).rejects.toThrow(
      /immutable/
    );
  });

  it("per-batch text failure isolation, and finalize reports pending coverage", async () => {
    const buildC = await createIndexBuild(db.executor, BUILD_OPTIONS);
    await populateBuildRecords(db.executor, buildC);

    let calls = 0;
    const embedChunks = makeEmbedChunksFn();
    const flaky = async (documents: ChunkedDocument[]) => {
      calls += 1;
      if (calls === 1) throw new Error("simulated batch outage");
      return embedChunks(documents);
    };
    // batchSize counts articles: the first batch is A1 alone.
    const a1Chunks = expectedChunkRecords()[0].records.length;
    const result = await embedBuildText(db.executor, buildC, {
      embedChunksFn: flaky,
      batchSize: 1,
    });
    expect(result.planned).toBe(TOTAL_CHUNKS);
    expect(result.failed).toHaveLength(a1Chunks);
    for (const failure of result.failed) {
      expect(failure.reason).toBe("simulated batch outage");
    }
    expect(result.embedded).toBe(TOTAL_CHUNKS - a1Chunks); // later batches still ran

    const finalized = await finalizeBuild(db.executor, buildC);
    expect(finalized.status).toBe("failed");
    expect(finalized.pendingChunks).toBe(a1Chunks);
    expect(finalized.failureReason).toContain(`${a1Chunks} text chunk(s)`);
    expect(finalized.failureReason).toContain("2 image(s)");
    const { rows } = await db.pg.query<{ status: string; failure_reason: string }>(
      "SELECT status, failure_reason FROM rag_index_builds WHERE id = $1",
      [buildC]
    );
    expect(rows[0].status).toBe("failed");
    expect(rows[0].failure_reason).toContain(`${a1Chunks} text chunk(s)`);
  });

  it("keeps concurrent builds disjoint; embedding one never touches the other", async () => {
    const buildD = await createIndexBuild(db.executor, BUILD_OPTIONS);
    const buildE = await createIndexBuild(db.executor, BUILD_OPTIONS);
    await populateBuildRecords(db.executor, buildD);
    await populateBuildRecords(db.executor, buildE); // uq_article_chunks_build satisfied

    const { rows: counts } = await db.pg.query<{ d: number; e: number; overlap: number }>(
      `SELECT (SELECT count(*)::int FROM article_chunks WHERE index_build_id = $1) AS d,
                    (SELECT count(*)::int FROM article_chunks WHERE index_build_id = $2) AS e,
                    (SELECT count(*)::int FROM article_chunks c1
                     JOIN article_chunks c2 ON c1.id = c2.id
                     WHERE c1.index_build_id = $1 AND c2.index_build_id = $2) AS overlap`,
      [buildD, buildE]
    );
    expect(counts[0]).toEqual({ d: TOTAL_CHUNKS, e: TOTAL_CHUNKS, overlap: 0 });

    await embedBuildText(db.executor, buildD, { embedChunksFn: makeEmbedChunksFn() });
    const { rows } = await db.pg.query<{ d_pending: number; e_pending: number }>(
      `SELECT (SELECT count(*)::int FROM article_chunks
                     WHERE index_build_id = $1 AND embedding_1024 IS NULL) AS d_pending,
                    (SELECT count(*)::int FROM article_chunks
                     WHERE index_build_id = $2 AND embedding_1024 IS NULL) AS e_pending`,
      [buildD, buildE]
    );
    expect(rows[0].d_pending).toBe(0);
    expect(rows[0].e_pending).toBe(TOTAL_CHUNKS); // untouched
  });

  it("never modifies legacy NULL-build rows, and a NULL-build fence holds", async () => {
    await db.pg.query(
      `INSERT INTO article_chunks
                 (id, article_id, chunk_index, chunk_text, embedding_input_hash,
                  embedding_model, embedding_input_version)
             VALUES ($1, $2, 0, 'legacy chunk text', 'legacy-hash', 'legacy-model', 'legacy-v0')`,
      [`${A3}:0000`, A3]
    );

    const buildF = await createIndexBuild(db.executor, BUILD_OPTIONS);
    await populateBuildRecords(db.executor, buildF);
    await embedBuildText(db.executor, buildF, { embedChunksFn: makeEmbedChunksFn() });

    const { rows: legacy } = await db.pg.query<{
      chunk_text: string;
      embedding_model: string;
      embedding_input_hash: string;
      has_embedding: boolean;
    }>(
      `SELECT chunk_text, embedding_model, embedding_input_hash,
                    (embedding_1024 IS NOT NULL) AS has_embedding
             FROM article_chunks WHERE id = $1 AND index_build_id IS NULL`,
      [`${A3}:0000`]
    );
    expect(legacy).toHaveLength(1);
    expect(legacy[0]).toEqual({
      chunk_text: "legacy chunk text",
      embedding_model: "legacy-model",
      embedding_input_hash: "legacy-hash",
      has_embedding: false,
    });

    // A NULL-build-fenced UPDATE (fenced with index_build_id IS NULL) can
    // never reach a build-scoped row.
    const buildRowId = `${buildF}:${A3}:0000`;
    const touched = await db.pg.query(
      `UPDATE article_chunks SET embedding_model = 'embed-mjs-touch'
             WHERE id = $1 AND index_build_id IS NULL`,
      [buildRowId]
    );
    expect(touched.affectedRows ?? 0).toBe(0);
    const { rows: buildRow } = await db.pg.query<{ embedding_model: string }>(
      "SELECT embedding_model FROM article_chunks WHERE id = $1",
      [buildRowId]
    );
    expect(buildRow[0].embedding_model).toBe(RAG_EMBEDDING_MODEL);
  });

  it("dryRunReport prices the exact chunk plan with cost-tracker constants", async () => {
    const before = await db.pg.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM article_chunks"
    );
    const report = await dryRunReport(db.executor, { corpusVersion: CORPUS });
    const after = await db.pg.query<{ n: number }>("SELECT count(*)::int AS n FROM article_chunks");
    expect(after.rows[0].n).toBe(before.rows[0].n); // read-only

    // Each article's header is sent once, ahead of its chunks.
    const expectedChars = expectedChunkRecords().reduce(
      (sum, entry) =>
        sum +
        entry.records[0].embeddingInput.header.length +
        entry.records.reduce((inner, record) => inner + record.embeddingInput.text.length, 0),
      0
    );
    expect(report.corpusVersion).toBe(CORPUS);
    expect(report.articles).toBe(3);
    expect(report.chunks).toBe(TOTAL_CHUNKS);
    expect(report.chunkChars).toBe(expectedChars);
    expect(report.estTextTokens).toBe(Math.ceil(expectedChars / 4));
    expect(report.images).toBe(2);

    // Pinned to the tracker's own pricing (imported, not re-stated).
    expect(report.estTextUsd).toBeCloseTo(
      computeEmbeddingCostUsd(RAG_EMBEDDING_MODEL, { total_tokens: report.estTextTokens }),
      12
    );
    expect(report.estTextUsd).toBeCloseTo((expectedChars / 4 / 1_000_000) * 0.12, 6);
    expect(report.estImageUsd).toBeCloseTo(
      computeEmbeddingCostUsd(RAG_IMAGE_EMBEDDING_MODEL, {
        total_tokens: 0,
        text_tokens: 0,
        image_pixels: report.images * ESTIMATED_PIXELS,
      }),
      12
    );
    // $0.60 per billion pixels.
    expect(report.estImageUsd).toBeCloseTo(report.images * 0.0009, 12);
    expect(report.totalUsd).toBeCloseTo(report.estTextUsd + report.estImageUsd, 12);
  });
});

async function solidImage(
  width: number,
  height: number,
  format: "jpeg" | "webp" | "png"
): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: "#888" } })
    .toFormat(format)
    .toBuffer();
}

async function pixelsOf(bytes: Buffer): Promise<{ width: number; height: number }> {
  const { width = 0, height = 0 } = await sharp(bytes).metadata();
  return { width, height };
}

describe("fitImageForVoyage", () => {
  it("fitImageForVoyage leaves an image under the limit untouched", async () => {
    const bytes = await solidImage(200, 100, "jpeg");
    const result = await fitImageForVoyage(bytes, "image/jpeg", 30_000);
    expect(result.bytes).toBe(bytes);
    expect(result.resized).toBe(false);
    expect(result.mimeType).toBe("image/jpeg");
  });

  it("fitImageForVoyage shrinks an oversized jpeg under the limit", async () => {
    const bytes = await solidImage(4100, 4000, "jpeg");
    const result = await fitImageForVoyage(bytes, "image/jpeg");
    const { width, height } = await pixelsOf(result.bytes);
    expect(width * height).toBeLessThanOrEqual(16_000_000);
    expect(Math.abs(width / height - 4100 / 4000) / (4100 / 4000)).toBeLessThan(0.01);
    expect(result.resized).toBe(true);
    expect(result.mimeType).toBe("image/jpeg");
  }, 60_000);

  it("fitImageForVoyage handles webp and png input", async () => {
    for (const [format, mime] of [
      ["webp", "image/webp"],
      ["png", "image/png"],
    ] as const) {
      const result = await fitImageForVoyage(await solidImage(300, 300, format), mime, 40_000);
      const { width, height } = await pixelsOf(result.bytes);
      expect(width * height).toBeLessThanOrEqual(40_000);
      expect(sniffImageMime(result.bytes)).toBe(result.mimeType);
    }
  });
});

describe("embed-images with an oversized photo", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
    await runMigrations(db.executor, { dir: MIGRATIONS_DIR });
    await insertFixture(db.pg);
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("embed-images sends a resized photo for an oversized object", async () => {
    const oversized = await solidImage(4100, 4000, "jpeg");
    const buildId = await createIndexBuild(db.executor, BUILD_OPTIONS);
    await populateBuildRecords(db.executor, buildId);
    const sent: Array<{ imageBase64?: string }> = [];
    const embedFn = async (inputs: Array<{ text: string; imageBase64?: string }>) => {
      sent.push(...inputs);
      return inputs.map((input) => deterministicVector(input.text));
    };
    const result = await embedBuildImages(db.executor, buildId, {
      embedFn,
      fetchObject: async () => streamOf(oversized),
    });

    expect(result.failed).toEqual([]);
    expect(sent.length).toBeGreaterThan(0);
    for (const input of sent) {
      const { width, height } = await pixelsOf(Buffer.from(input.imageBase64 ?? "", "base64"));
      expect(width * height).toBeLessThanOrEqual(16_000_000);
    }
  }, 120_000);
});
