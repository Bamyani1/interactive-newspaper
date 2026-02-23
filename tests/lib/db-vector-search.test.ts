import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock setup ────────────────────────────────────────────────────────
// vi.hoisted ensures mockSql is available when vi.mock (which is hoisted) runs.
const { mockSql } = vi.hoisted(() => ({ mockSql: vi.fn() }));
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
    mockSql.mockResolvedValueOnce(rows);

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
    });
    expect(results[1].headline).toBe("Second Article");
    expect(results[1].distance).toBe(0.4);
    expect(results[1].source).toBe("vector");
  });

  it("respects the limit option", async () => {
    mockSql.mockResolvedValueOnce([]);

    await queryArticlesByEmbedding(DUMMY_EMBEDDING, { limit: 5 });

    expect(mockSql).toHaveBeenCalledTimes(1);
    // The tagged template call receives template parts + interpolated values.
    // The limit (5) should appear among the arguments.
    const callArgs = mockSql.mock.calls[0];
    const interpolatedValues = callArgs.slice(1);
    expect(interpolatedValues).toContain(5);
  });

  it("returns empty array when no rows match", async () => {
    mockSql.mockResolvedValueOnce([]);

    const results = await queryArticlesByEmbedding(DUMMY_EMBEDDING);

    expect(results).toEqual([]);
  });

  it("handles null byline correctly", async () => {
    const rows = [makeVectorRow({ byline: null })];
    mockSql.mockResolvedValueOnce(rows);

    const results = await queryArticlesByEmbedding(DUMMY_EMBEDDING);

    expect(results[0].byline).toBeNull();
  });
});

// ── hybridSearch ──────────────────────────────────────────────────────

describe("hybridSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("merges vector and FTS results sorted by RRF score", async () => {
    const vectorRows = [
      makeVectorRow({ id: "vec-1", headline: "Vector Article 1", distance: "0.1000" }),
      makeVectorRow({ id: "vec-2", headline: "Vector Article 2", distance: "0.3000" }),
    ];
    const ftsRows = [
      makeFtsRow({ id: "fts-1", headline: "FTS Article 1", rank: "0.9000" }),
      makeFtsRow({ id: "fts-2", headline: "FTS Article 2", rank: "0.5000" }),
    ];
    mockSql.mockResolvedValueOnce(vectorRows).mockResolvedValueOnce(ftsRows);

    const results = await hybridSearch("test question", DUMMY_EMBEDDING);

    expect(results.length).toBe(4);
    // All four unique articles should be present
    const ids = results.map((r) => r.id);
    expect(ids).toContain("vec-1");
    expect(ids).toContain("vec-2");
    expect(ids).toContain("fts-1");
    expect(ids).toContain("fts-2");
    // First result should be vec-1 (rank 0 in vector, highest vector weight)
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
    mockSql.mockResolvedValueOnce(vectorRows).mockResolvedValueOnce(ftsRows);

    const results = await hybridSearch("test question", DUMMY_EMBEDDING);

    // Shared article should appear only once
    const sharedOccurrences = results.filter((r) => r.id === sharedId);
    expect(sharedOccurrences).toHaveLength(1);
    // Total should be 3 (not 4) due to deduplication
    expect(results).toHaveLength(3);
    // The shared article gets boosted (both vector + FTS scores) and should rank first
    expect(results[0].id).toBe(sharedId);
  });

  it("marks FTS-only articles with source 'fts'", async () => {
    const vectorRows = [makeVectorRow({ id: "vec-1", distance: "0.1000" })];
    const ftsRows = [makeFtsRow({ id: "fts-1", rank: "0.9000" })];
    mockSql.mockResolvedValueOnce(vectorRows).mockResolvedValueOnce(ftsRows);

    const results = await hybridSearch("test question", DUMMY_EMBEDDING);

    const ftsArticle = results.find((r) => r.id === "fts-1");
    expect(ftsArticle).toBeDefined();
    expect(ftsArticle!.source).toBe("fts");
  });

  it("marks vector-only articles with source 'vector'", async () => {
    const vectorRows = [makeVectorRow({ id: "vec-1", distance: "0.1000" })];
    const ftsRows = [makeFtsRow({ id: "fts-1", rank: "0.9000" })];
    mockSql.mockResolvedValueOnce(vectorRows).mockResolvedValueOnce(ftsRows);

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
    mockSql.mockResolvedValueOnce(vectorRows).mockResolvedValueOnce(ftsRows);

    const results = await hybridSearch("test question", DUMMY_EMBEDDING, { limit: 3 });

    expect(results.length).toBeLessThanOrEqual(3);
  });
});
