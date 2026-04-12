import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock setup ────────────────────────────────────────────────────────
// vi.hoisted ensures mockSql is available when vi.mock (which is hoisted) runs.
const { mockSql } = vi.hoisted(() => {
  const fn = vi.fn() as ReturnType<typeof vi.fn> & { transaction: ReturnType<typeof vi.fn> };
  fn.transaction = vi.fn();
  return { mockSql: fn };
});
vi.mock("@neondatabase/serverless", () => ({
  neon: vi.fn(() => mockSql),
}));

import { queryArticlesByEmbedding, hybridSearch } from "@/src/lib/db";
import type { RetrievedArticle } from "@/src/lib/db";

// ── Helpers ───────────────────────────────────────────────────────────

function makeVectorRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "1960-01-07-0",
    edition_date: "1960-01-07",
    category: "News",
    headline: "Test Headline",
    summary: "Test summary",
    byline: "Test Author",
    body_plain: "Test body",
    image_urls: [],
    distance: "0.2500",
    ...overrides,
  };
}

function makeFtsRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "1960-01-07-1",
    edition_date: "1960-01-07",
    category: "Sports",
    headline: "Game Results",
    summary: "Sports summary",
    byline: null,
    body_plain: "Sports body",
    image_urls: [],
    rank: "0.8500",
    ...overrides,
  };
}

const DUMMY_EMBEDDING = Array.from({ length: 3 }, (_, i) => i * 0.1);

// ── queryArticlesByEmbedding ──────────────────────────────────────────

describe("queryArticlesByEmbedding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns mapped results with correct fields and source 'vector'", async () => {
    const rows = [
      makeVectorRow({ id: "1960-01-07-0", distance: "0.2500" }),
      makeVectorRow({ id: "1960-01-07-1", headline: "Second Article", distance: "0.4000" }),
    ];
    // sql.transaction returns [SET_LOCAL_result, SELECT_result]
    mockSql.transaction.mockResolvedValueOnce([[], rows]);

    const results = await queryArticlesByEmbedding(DUMMY_EMBEDDING);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual<RetrievedArticle>({
      id: "1960-01-07-0",
      editionDate: "1960-01-07",
      category: "News",
      headline: "Test Headline",
      summary: "Test summary",
      byline: "Test Author",
      bodyPlain: "Test body",
      distance: 0.25,
      source: "vector",
      imageUrls: [],
    });
    expect(results[1].headline).toBe("Second Article");
    expect(results[1].distance).toBe(0.4);
    expect(results[1].source).toBe("vector");
  });

  it("respects the limit option", async () => {
    mockSql.transaction.mockResolvedValueOnce([[], []]);

    await queryArticlesByEmbedding(DUMMY_EMBEDDING, { limit: 5 });

    expect(mockSql.transaction).toHaveBeenCalledTimes(1);
  });

  it("returns empty array when no rows match", async () => {
    mockSql.transaction.mockResolvedValueOnce([[], []]);

    const results = await queryArticlesByEmbedding(DUMMY_EMBEDDING);

    expect(results).toEqual([]);
  });

  it("handles null byline correctly", async () => {
    const rows = [makeVectorRow({ byline: null })];
    mockSql.transaction.mockResolvedValueOnce([[], rows]);

    const results = await queryArticlesByEmbedding(DUMMY_EMBEDDING);

    expect(results[0].byline).toBeNull();
  });
});

// ── hybridSearch ──────────────────────────────────────────────────────

describe("hybridSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Helper: mock the three sql calls that hybridSearch triggers:
  // 1-2: two tagged template calls inside queryArticlesByEmbedding's transaction array (SET LOCAL + SELECT)
  // 3: one tagged template call for FTS in searchArticlesForRag
  // Plus: sql.transaction() for the vector search wrapper
  function mockHybridCalls(vectorRows: Record<string, unknown>[], ftsRows: Record<string, unknown>[]) {
    mockSql
      .mockResolvedValueOnce([])  // SET LOCAL (dummy, transaction overrides)
      .mockResolvedValueOnce([])  // SELECT vector (dummy, transaction overrides)
      .mockResolvedValueOnce(ftsRows);
    mockSql.transaction.mockResolvedValueOnce([[], vectorRows]);
  }

  it("merges vector and FTS results sorted by RRF score", async () => {
    const vectorRows = [
      makeVectorRow({ id: "vec-1", headline: "Vector Article 1", distance: "0.1000" }),
      makeVectorRow({ id: "vec-2", headline: "Vector Article 2", distance: "0.3000" }),
    ];
    const ftsRows = [
      makeFtsRow({ id: "fts-1", headline: "FTS Article 1", rank: "0.9000" }),
      makeFtsRow({ id: "fts-2", headline: "FTS Article 2", rank: "0.5000" }),
    ];
    mockHybridCalls(vectorRows, ftsRows);

    const results = await hybridSearch("test question", DUMMY_EMBEDDING);

    expect(results.length).toBe(4);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("vec-1");
    expect(ids).toContain("vec-2");
    expect(ids).toContain("fts-1");
    expect(ids).toContain("fts-2");
    expect(results[0].id).toBe("vec-1");
  });

  it("deduplicates articles found by both vector and FTS", async () => {
    const sharedId = "1960-01-07-0";
    const vectorRows = [
      makeVectorRow({ id: sharedId, headline: "Shared Article", distance: "0.1500" }),
      makeVectorRow({ id: "vec-only", headline: "Vector Only", distance: "0.3000" }),
    ];
    const ftsRows = [
      makeFtsRow({ id: sharedId, headline: "Shared Article", rank: "0.9000" }),
      makeFtsRow({ id: "fts-only", headline: "FTS Only", rank: "0.5000" }),
    ];
    mockHybridCalls(vectorRows, ftsRows);

    const results = await hybridSearch("test question", DUMMY_EMBEDDING);

    const sharedOccurrences = results.filter((r) => r.id === sharedId);
    expect(sharedOccurrences).toHaveLength(1);
    expect(results).toHaveLength(3);
    expect(results[0].id).toBe(sharedId);
  });

  it("marks FTS-only articles with source 'fts'", async () => {
    const vectorRows = [makeVectorRow({ id: "vec-1", distance: "0.1000" })];
    const ftsRows = [makeFtsRow({ id: "fts-1", rank: "0.9000" })];
    mockHybridCalls(vectorRows, ftsRows);

    const results = await hybridSearch("test question", DUMMY_EMBEDDING);

    const ftsArticle = results.find((r) => r.id === "fts-1");
    expect(ftsArticle).toBeDefined();
    expect(ftsArticle!.source).toBe("fts");
    expect(ftsArticle!.distance).toBeNull();
  });

  it("marks vector-only articles with source 'vector'", async () => {
    const vectorRows = [makeVectorRow({ id: "vec-1", distance: "0.1000" })];
    const ftsRows = [makeFtsRow({ id: "fts-1", rank: "0.9000" })];
    mockHybridCalls(vectorRows, ftsRows);

    const results = await hybridSearch("test question", DUMMY_EMBEDDING);

    const vectorArticle = results.find((r) => r.id === "vec-1");
    expect(vectorArticle).toBeDefined();
    expect(vectorArticle!.source).toBe("vector");
  });

  it("respects the limit option", async () => {
    const vectorRows = [
      makeVectorRow({ id: "v1", distance: "0.1000" }),
      makeVectorRow({ id: "v2", distance: "0.2000" }),
      makeVectorRow({ id: "v3", distance: "0.3000" }),
    ];
    const ftsRows = [
      makeFtsRow({ id: "f1", rank: "0.9000" }),
      makeFtsRow({ id: "f2", rank: "0.7000" }),
      makeFtsRow({ id: "f3", rank: "0.5000" }),
    ];
    mockHybridCalls(vectorRows, ftsRows);

    const results = await hybridSearch("test question", DUMMY_EMBEDDING, { limit: 3 });

    expect(results.length).toBeLessThanOrEqual(3);
  });
});
