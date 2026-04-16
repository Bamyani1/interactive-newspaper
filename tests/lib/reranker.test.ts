import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: {
      generateContent: vi.fn(),
    },
  })),
}));

vi.stubEnv("GEMINI_API_KEY", "test-key");

import { rerankArticles, parseScores } from "@/src/lib/reranker";
import { GoogleGenAI } from "@google/genai";
import type { RetrievedArticle } from "@/src/lib/db";

function makeArticle(overrides: Partial<RetrievedArticle> = {}): RetrievedArticle {
  return {
    id: "1960-01-07-0",
    editionDate: "1960-01-07",
    category: "News",
    headline: "Test Headline",
    summary: "Test summary",
    byline: null,
    bodyPlain: "Test body",
    distance: 0.25,
    source: "vector",
    ...overrides,
  };
}

describe("parseScores", () => {
  it("parses valid JSON array of scores", () => {
    expect(parseScores("[8, 3, 6, 1, 9]", 5)).toEqual([8, 3, 6, 1, 9]);
  });

  it("parses scores with surrounding text", () => {
    expect(parseScores("Here are the scores: [7, 4, 2]", 3)).toEqual([7, 4, 2]);
  });

  it("returns null for wrong count", () => {
    expect(parseScores("[8, 3]", 5)).toBeNull();
  });

  it("returns null for scores out of 0-10 range", () => {
    expect(parseScores("[8, 15, 6]", 3)).toBeNull();
  });

  it("returns null for negative scores", () => {
    expect(parseScores("[8, -1, 6]", 3)).toBeNull();
  });

  it("returns null for non-numeric values", () => {
    expect(parseScores('["high", "low"]', 2)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseScores("", 3)).toBeNull();
  });

  it("returns null for no JSON array", () => {
    expect(parseScores("I cannot score these", 3)).toBeNull();
  });

  it("parses decimal scores and floors them to integers", () => {
    expect(parseScores("[8.5, 3.2, 6.0]", 3)).toEqual([8.5, 3.2, 6]);
  });
});

describe("rerankArticles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (GoogleGenAI as unknown as ReturnType<typeof vi.fn>).mockClear();
    (GoogleGenAI as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      models: {
        generateContent: vi.fn(),
      },
    }));
  });

  it("returns empty array for empty input", async () => {
    const result = await rerankArticles("test?", []);
    expect(result).toEqual([]);
  });

  it("skips LLM call for 2 or fewer articles", async () => {
    const articles = [makeArticle({ id: "a" }), makeArticle({ id: "b" })];
    const result = await rerankArticles("test?", articles);

    expect(result).toHaveLength(2);
    expect(result[0].relevanceScore).toBe(5);
    expect(result[1].relevanceScore).toBe(5);
  });

  it("filters and sorts articles by relevance score", async () => {
    (GoogleGenAI as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      models: {
        generateContent: vi.fn().mockResolvedValue({
          text: "[8, 1, 6]",
        }),
      },
    }));

    vi.resetModules();
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const mod = await import("@/src/lib/reranker");

    const articles = [
      makeArticle({ id: "a", headline: "Relevant" }),
      makeArticle({ id: "b", headline: "Irrelevant" }),
      makeArticle({ id: "c", headline: "Somewhat relevant" }),
    ];

    const result = await mod.rerankArticles("test?", articles, { minScore: 3 });

    // Article "b" (score 1) should be filtered out
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("a"); // score 8
    expect(result[0].relevanceScore).toBe(8);
    expect(result[1].id).toBe("c"); // score 6
    expect(result[1].relevanceScore).toBe(6);
  });

  it("respects maxArticles cap", async () => {
    (GoogleGenAI as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      models: {
        generateContent: vi.fn().mockResolvedValue({
          text: "[8, 7, 6]",
        }),
      },
    }));

    vi.resetModules();
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const mod = await import("@/src/lib/reranker");

    const articles = [
      makeArticle({ id: "a" }),
      makeArticle({ id: "b" }),
      makeArticle({ id: "c" }),
    ];

    const result = await mod.rerankArticles("test?", articles, { maxArticles: 2 });
    expect(result).toHaveLength(2);
  });

  it("returns original articles with default score on API error", async () => {
    (GoogleGenAI as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      models: {
        generateContent: vi.fn().mockRejectedValue(new Error("API error")),
      },
    }));

    vi.resetModules();
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const mod = await import("@/src/lib/reranker");

    const articles = [
      makeArticle({ id: "a" }),
      makeArticle({ id: "b" }),
      makeArticle({ id: "c" }),
    ];

    const result = await mod.rerankArticles("test?", articles);
    expect(result).toHaveLength(3);
    expect(result.every((a) => a.relevanceScore === 5)).toBe(true);
  });

  it("returns original articles on unparseable response", async () => {
    (GoogleGenAI as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      models: {
        generateContent: vi.fn().mockResolvedValue({
          text: "I can't score these",
        }),
      },
    }));

    vi.resetModules();
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const mod = await import("@/src/lib/reranker");

    const articles = [
      makeArticle({ id: "a" }),
      makeArticle({ id: "b" }),
      makeArticle({ id: "c" }),
    ];

    const result = await mod.rerankArticles("test?", articles);
    expect(result).toHaveLength(3);
    expect(result.every((a) => a.relevanceScore === 5)).toBe(true);
  });

  it("passes exactly 2000 chars of article body to the reranker LLM", async () => {
    const generateContentMock = vi.fn().mockResolvedValue({ text: "[8, 7, 6]" });
    (GoogleGenAI as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      models: { generateContent: generateContentMock },
    }));

    vi.resetModules();
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const mod = await import("@/src/lib/reranker");

    const longBody = "X".repeat(5000);
    const articles = [
      makeArticle({ id: "a", bodyPlain: longBody }),
      makeArticle({ id: "b", bodyPlain: "short" }),
      makeArticle({ id: "c", bodyPlain: "short" }),
    ];

    await mod.rerankArticles("test?", articles, { minScore: 0 });

    const call = generateContentMock.mock.calls[0][0];
    const userPrompt = call.contents[0].parts[0].text as string;
    const m = userPrompt.match(/Excerpt:\s*(X+)/);
    expect(m).toBeTruthy();
    expect(m![1].length).toBe(2000);
  });
});
