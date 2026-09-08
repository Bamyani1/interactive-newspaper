/** @vitest-environment node */
// The defect this script exists to catch is silent: a serving filter that
// matches no rows. These cases pin the four ways the check must speak up —
// a healthy versioned build, a legacy filter that reaches nothing, one broken
// readiness predicate named individually, and a served-table stamp mismatch.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertMigrationsCurrent, runMigrations } from "../../scripts/db/lib/migration-runner";
import {
  checkRagHealth,
  formatReport,
  servingPlan,
} from "../../scripts/db/check-rag-health.mjs";
import { MIGRATIONS_DIR, createTestDb, type TestDb } from "./helpers/pglite";

const CORPUS = "corpus-health-v1";
const DATE = "1962-11-06";
const ARTICLE = "1962-11-06-0";
const BUILD = "build-health-live";

const MODEL = "gemini-embedding-2";
const TEXT_INPUT = "article-chunk-v1";
const IMAGE_INPUT = "article-image-v1";
const PIPELINE = "rag-v3-independent-grounded";

/** A config as getRagRetrievalConfig() would resolve it, without touching env. */
function config(overrides: Record<string, unknown> = {}) {
  return {
    mode: "versioned",
    activeIndexBuildId: BUILD,
    corpusVersion: CORPUS,
    pipelineVersion: PIPELINE,
    embeddingModel: MODEL,
    textEmbeddingInputVersion: TEXT_INPUT,
    imageEmbeddingInputVersion: IMAGE_INPUT,
    cacheIdentity: "test-identity",
    ...overrides,
  };
}

const deps = { assertMigrationsCurrent };

async function insertBuild(
  db: TestDb,
  id: string,
  status: string,
  overrides: { corpusVersion?: string; pipelineVersion?: string } = {}
): Promise<void> {
  await db.pg.query(
    `INSERT INTO rag_index_builds
             (id, corpus_version, status, pipeline_version, embedding_model,
              text_embedding_input_version, image_embedding_input_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      id,
      overrides.corpusVersion ?? CORPUS,
      status,
      overrides.pipelineVersion ?? PIPELINE,
      MODEL,
      TEXT_INPUT,
      IMAGE_INPUT,
    ]
  );
}

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
              embedding, embedding_model, embedding_input_version, embedding_input_hash)
         VALUES ($1, $2, $3, $4, 'chunk text', $5, $6, $7, $1)`,
    [
      id,
      buildId,
      ARTICLE,
      // chunk_index must stay unique per (build, article).
      Number(id.replace(/\D/g, "") || 0),
      embedded ? `[${new Array(768).fill(0.01).join(",")}]` : null,
      stamp.model ?? MODEL,
      stamp.inputVersion ?? TEXT_INPUT,
    ]
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

    // Every readiness predicate is reported by name, not as one verdict.
    expect(Object.keys(report.build.row).sort()).toEqual([
      "active_count",
      "corpus_version",
      "embedding_model",
      "image_embedding_input_version",
      "pipeline_version",
      "status",
      "text_embedding_input_version",
    ]);
    expect(Object.values(report.build.row).every((check) => check.ok)).toBe(true);
  });

  it("fails legacy mode whose serving filter reaches nothing", async () => {
    // The corpus lives in article_chunks under a build; articles.embedding
    // is NULL, so the legacy filter matches zero rows. This is the exact
    // silent defect: retrieval would degrade to full-text without erroring.
    const report = await checkRagHealth(db.executor, {
      config: config({ mode: "legacy", activeIndexBuildId: null }),
      ...deps,
    });

    expect(report.healthy).toBe(false);
    expect(report.served.table).toBe("articles");
    expect(report.served.predicate.count).toBe(0);
    expect(report.served.stamps).toEqual([]);
    expect(report.failures.join("\n")).toMatch(/served\.predicate matched 0 rows in articles/);
    // Legacy retrieval has no build row, and the check must not invent one.
    expect(report.build).toMatchObject({ applicable: false });
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
      Object.entries(report.build.row)
        .filter(([, check]) => !check.ok)
        .map(([name]) => name)
    ).toEqual(["corpus_version"]);
    expect(report.failures.join("\n")).toMatch(/build\.row\.corpus_version/);
  });

  it("fails a stamp mismatch even when the build row is ready", async () => {
    // Config bumped its text-embedding input version; the served rows are
    // still stamped with the old one.
    const report = await checkRagHealth(db.executor, {
      config: config({ textEmbeddingInputVersion: "article-chunk-v2" }),
      ...deps,
    });

    expect(report.healthy).toBe(false);
    expect(report.served.predicate.count).toBe(0);
    expect(report.served.stamps).toEqual([
      { embeddingModel: MODEL, embeddingInputVersion: TEXT_INPUT, rows: 2 },
    ]);
    const failures = report.failures.join("\n");
    expect(failures).toMatch(
      /served\.stamps: article_chunks holds no rows stamped \(gemini-embedding-2, article-chunk-v2\)/
    );
    expect(failures).toMatch(/present: \(gemini-embedding-2, article-chunk-v1\)/);
    // A config-side bump shows up in both places, and both are named.
    expect(report.build.row.text_embedding_input_version).toEqual({
      ok: false,
      expected: "article-chunk-v2",
      actual: TEXT_INPUT,
    });
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
    const healthy = formatReport(
      await checkRagHealth(db.executor, { config: config(), ...deps })
    );
    expect(healthy).toMatch(/ok {3}migrations\.current/);
    expect(healthy).toMatch(/ok {3}served\.predicate {8}2 row\(s\) match WHERE/);
    expect(healthy).toMatch(/coverage\.ratio {10}1\.0000 \(2\/2\)/);
    expect(healthy).not.toMatch(/Mismatches:/);

    const broken = formatReport(
      await checkRagHealth(db.executor, {
        config: config({ mode: "legacy", activeIndexBuildId: null }),
        ...deps,
      })
    );
    expect(broken).toMatch(/FAIL served\.predicate {8}0 row\(s\) match WHERE/);
    expect(broken).toMatch(/build\.row {15}n\/a/);
    expect(broken).toMatch(/Mismatches:/);
  });

  it("mirrors db.ts's serving filters verbatim", () => {
    expect(servingPlan(config())).toMatchObject({
      table: "article_chunks",
      buildScoped: true,
      where:
        "embedding IS NOT NULL AND index_build_id = $1 AND embedding_model = $2 " +
        "AND embedding_input_version = $3",
      params: [BUILD, MODEL, TEXT_INPUT],
    });
    expect(servingPlan(config({ mode: "legacy", activeIndexBuildId: null }))).toMatchObject({
      table: "articles",
      buildScoped: false,
      where: "embedding IS NOT NULL AND embedding_model = $1",
      params: [MODEL],
    });
  });
});
