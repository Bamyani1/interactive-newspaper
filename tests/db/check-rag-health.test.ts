/** @vitest-environment node */
// The defect this script exists to catch is silent: a serving filter that
// matches no rows. These cases pin the ways the check must speak up — a
// healthy versioned build, a build whose filter reaches nothing, one broken
// readiness predicate named individually, a served-table stamp mismatch, and
// a photo filter that reaches nothing.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertMigrationsCurrent, runMigrations } from "../../scripts/db/lib/migration-runner";
import {
  checkRagHealth,
  formatReport,
  imageServingPlan,
  readServingPointer,
  servingPlan,
} from "../../scripts/db/check-rag-health.mjs";
import { MIGRATIONS_DIR, createTestDb, type TestDb } from "./helpers/pglite";

const CORPUS = "corpus-health-v1";
const DATE = "1962-11-06";
const ARTICLE = "1962-11-06-0";
const BUILD = "build-health-live";

const MODEL = "voyage-context-4";
const IMAGE_MODEL = "voyage-multimodal-3.5";
const DIMS = 1024;
const TEXT_INPUT = "article-chunk-voyage-v1";
const IMAGE_INPUT = "article-image-voyage-v1";
const PIPELINE = "rag-v4-voyage";

/** A config as getRagRetrievalConfig() would resolve it, without touching env. */
function config(overrides: Record<string, unknown> = {}) {
  return {
    mode: "versioned",
    activeIndexBuildId: BUILD,
    corpusVersion: CORPUS,
    pipelineVersion: PIPELINE,
    embeddingModel: MODEL,
    imageEmbeddingModel: IMAGE_MODEL,
    embeddingDims: DIMS,
    textEmbeddingInputVersion: TEXT_INPUT,
    imageEmbeddingInputVersion: IMAGE_INPUT,
    cacheIdentity: "test-identity",
    ...overrides,
  };
}

const deps = { assertMigrationsCurrent };

/** One assertConfiguredIndexBuildReady predicate, as the .mjs check reports it. */
interface Predicate {
  ok: boolean;
  expected: unknown;
  actual: unknown;
}

// `build` is a union (missing / present), so narrow at the read site.
function predicates(report: { build: unknown }): Array<[string, Predicate]> {
  const { row } = report.build as { row?: Record<string, Predicate> };
  return Object.entries(row ?? {});
}

async function insertBuild(
  db: TestDb,
  id: string,
  status: string,
  overrides: { corpusVersion?: string; pipelineVersion?: string } = {}
): Promise<void> {
  await db.pg.query(
    `INSERT INTO rag_index_builds
             (id, corpus_version, status, pipeline_version, embedding_model,
              image_embedding_model, embedding_dims,
              text_embedding_input_version, image_embedding_input_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id,
      overrides.corpusVersion ?? CORPUS,
      status,
      overrides.pipelineVersion ?? PIPELINE,
      MODEL,
      IMAGE_MODEL,
      DIMS,
      TEXT_INPUT,
      IMAGE_INPUT,
    ]
  );
}

const VECTOR = `[${new Array(DIMS).fill(0.01).join(",")}]`;

async function insertChunk(
  db: TestDb,
  id: string,
  buildId: string | null,
  stamp: { model?: string; inputVersion?: string } = {},
  embedded = true
): Promise<void> {
  await db.pg.query(
    `INSERT INTO article_chunks
             (id, index_build_id, article_id, chunk_index, chunk_text,
              embedding_1024, embedding_model, embedding_input_version, embedding_input_hash)
         VALUES ($1, $2, $3, $4, 'chunk text', $5, $6, $7, $1)`,
    [
      id,
      buildId,
      ARTICLE,
      // chunk_index must stay unique per (build, article).
      Number(id.replace(/\D/g, "") || 0),
      embedded ? VECTOR : null,
      stamp.model ?? MODEL,
      stamp.inputVersion ?? TEXT_INPUT,
    ]
  );
}

async function insertImage(db: TestDb, id: string, buildId: string): Promise<void> {
  await db.pg.query(
    `INSERT INTO article_images
             (id, index_build_id, article_id, image_index, image_url,
              embedding_1024, embedding_model, embedding_input_version, embedding_input_hash)
         VALUES ($1, $2, $3, 0, 'https://example.test/a.jpg', $4, $5, $6, $1)`,
    [id, buildId, ARTICLE, VECTOR, IMAGE_MODEL, IMAGE_INPUT]
  );
}

describe("check-rag-health", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
    await runMigrations(db.executor, { dir: MIGRATIONS_DIR });
    await db.pg.query(
      `INSERT INTO editions (date, publication_info, page_count, article_count)
             VALUES ($1, 'Test', 1, 1)`,
      [DATE]
    );
    await db.pg.query(
      `INSERT INTO articles (id, edition_date, position, category, headline, summary,
                                   full_text, body_plain, page, image_urls, image_captions)
             VALUES ($1, $2, 0, 'news', 'h', 's', 'f', 'b', 1, '[]', '[]')`,
      [ARTICLE, DATE]
    );
    await insertBuild(db, BUILD, "active");
    await insertChunk(db, "1", BUILD);
    await insertChunk(db, "2", BUILD);
    await insertImage(db, "img-1", BUILD);
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("passes a healthy versioned config and counts the serving predicate", async () => {
    const report = await checkRagHealth(db.executor, { config: config(), ...deps });

    expect(report.failures).toEqual([]);
    expect(report.healthy).toBe(true);
    expect(report.config.mode).toBe("versioned");
    expect(report.migrations.current).toBe(true);
    expect(report.served.table).toBe("article_chunks");
    expect(report.served.predicate.count).toBe(2);
    expect(report.served.stamps).toEqual([
      { embeddingModel: MODEL, embeddingInputVersion: TEXT_INPUT, rows: 2 },
    ]);
    expect(report.coverage).toEqual({ total: 2, embedded: 2, ratio: 1 });
    expect(report.served.images).toMatchObject({ table: "article_images", count: 1 });

    // Every readiness predicate is reported by name, not as one verdict.
    expect(Object.keys(report.build.row).sort()).toEqual([
      "active_count",
      "corpus_version",
      "embedding_dims",
      "embedding_model",
      "image_embedding_input_version",
      "image_embedding_model",
      "pipeline_version",
      "status",
      "text_embedding_input_version",
    ]);
    expect(predicates(report).every(([, check]) => check.ok)).toBe(true);
  });

  it("fails a configured build whose serving filter reaches nothing", async () => {
    // No rows carry this build id, so the filter matches zero rows. This is the
    // exact silent defect: retrieval would degrade to full-text without erroring.
    const report = await checkRagHealth(db.executor, {
      config: config({ activeIndexBuildId: "build-missing" }),
      ...deps,
    });

    expect(report.healthy).toBe(false);
    expect(report.served.table).toBe("article_chunks");
    expect(report.served.predicate.count).toBe(0);
    expect(report.failures.join("\n")).toMatch(
      /served\.predicate matched 0 rows in article_chunks/
    );
    expect(report.build).toMatchObject({ exists: false });
  });

  it("names the single readiness predicate that failed", async () => {
    const report = await checkRagHealth(db.executor, {
      config: config({ corpusVersion: "corpus-that-moved-on" }),
      ...deps,
    });

    expect(report.healthy).toBe(false);
    expect(report.build.row.corpus_version).toEqual({
      ok: false,
      expected: "corpus-that-moved-on",
      actual: CORPUS,
    });
    // Only that one predicate failed; the rest still report ok.
    expect(
      predicates(report)
        .filter(([, check]) => !check.ok)
        .map(([name]) => name)
    ).toEqual(["corpus_version"]);
    expect(report.failures.join("\n")).toMatch(/build\.row\.corpus_version/);
  });

  it("fails a stamp mismatch even when the build row is ready", async () => {
    // Config bumped its text-embedding input version; the served rows are
    // still stamped with the old one.
    const report = await checkRagHealth(db.executor, {
      config: config({ textEmbeddingInputVersion: "article-chunk-voyage-v2" }),
      ...deps,
    });

    expect(report.healthy).toBe(false);
    expect(report.served.predicate.count).toBe(0);
    expect(report.served.stamps).toEqual([
      { embeddingModel: MODEL, embeddingInputVersion: TEXT_INPUT, rows: 2 },
    ]);
    const failures = report.failures.join("\n");
    expect(failures).toMatch(
      /served\.stamps: article_chunks holds no rows stamped \(voyage-context-4, article-chunk-voyage-v2\)/
    );
    expect(failures).toMatch(/present: \(voyage-context-4, article-chunk-voyage-v1\)/);
    // A config-side bump shows up in both places, and both are named.
    expect(report.build.row.text_embedding_input_version).toEqual({
      ok: false,
      expected: "article-chunk-voyage-v2",
      actual: TEXT_INPUT,
    });
  });

  it("fails a build whose photos carry a different model than the config", async () => {
    // Text serves fine, so only the photo search would come back empty.
    const report = await checkRagHealth(db.executor, {
      config: config({ imageEmbeddingModel: "voyage-multimodal-9" }),
      ...deps,
    });

    expect(report.healthy).toBe(false);
    expect(report.served.predicate.count).toBe(2);
    expect(report.served.images?.count).toBe(0);
    const failures = report.failures.join("\n");
    expect(failures).toMatch(/served\.images matched 0 rows in article_images/);
    expect(failures).toMatch(/build\.row\.image_embedding_model/);
  });

  it("reports incomplete coverage without inventing a passing ratio", async () => {
    await insertChunk(db, "3", BUILD, {}, false);
    try {
      const report = await checkRagHealth(db.executor, {
        config: config(),
        ...deps,
      });
      expect(report.coverage).toEqual({
        total: 3,
        embedded: 2,
        ratio: 2 / 3,
      });
      // Coverage is diagnostic; the serving filter still reaches rows.
      expect(report.served.predicate.count).toBe(2);
    } finally {
      await db.pg.query("DELETE FROM article_chunks WHERE id = '3'");
    }
  });

  it("renders a human report that names each failure", async () => {
    const healthy = formatReport(await checkRagHealth(db.executor, { config: config(), ...deps }));
    expect(healthy).toMatch(/ok {3}migrations\.current/);
    expect(healthy).toMatch(/ok {3}served\.predicate {8}2 row\(s\) match WHERE/);
    expect(healthy).toMatch(/coverage\.ratio {10}1\.0000 \(2\/2\)/);
    expect(healthy).toMatch(/ok {3}served\.images {11}1 photo\(s\) match WHERE/);
    expect(healthy).not.toMatch(/Mismatches:/);

    const broken = formatReport(
      await checkRagHealth(db.executor, {
        config: config({ activeIndexBuildId: "build-missing" }),
        ...deps,
      })
    );
    expect(broken).toMatch(/FAIL served\.predicate {8}0 row\(s\) match WHERE/);
    expect(broken).toMatch(/FAIL build\.row {15}missing/);
    expect(broken).toMatch(/Mismatches:/);
  });

  it("mirrors db.ts's serving filters verbatim", () => {
    expect(servingPlan(config())).toMatchObject({
      table: "article_chunks",
      buildScoped: true,
      vectorColumn: "embedding_1024",
      where:
        "embedding_1024 IS NOT NULL AND index_build_id = $1 AND embedding_model = $2 " +
        "AND embedding_input_version = $3",
      params: [BUILD, MODEL, TEXT_INPUT],
    });
    expect(imageServingPlan(config())).toMatchObject({
      table: "article_images",
      where:
        "embedding_1024 IS NOT NULL AND index_build_id = $1 AND embedding_model = $2 " +
        "AND embedding_input_version = $3",
      params: [BUILD, IMAGE_MODEL, IMAGE_INPUT],
    });
  });

  it("reads the serving pointer, and null before there is one or without its table", async () => {
    expect(await readServingPointer(db.executor)).toBeNull();
    await db.pg.query(
      `INSERT INTO rag_serving_pointer (id, index_build_id, corpus_version) VALUES (1, $1, 'c')`,
      [BUILD]
    );
    expect(await readServingPointer(db.executor)).toEqual({
      indexBuildId: BUILD,
      corpusVersion: "c",
    });
    const broken = { ...db.executor, query: async () => Promise.reject(new Error("no table")) };
    expect(await readServingPointer(broken)).toBeNull();
    await db.pg.query("DELETE FROM rag_serving_pointer");
  });
});
