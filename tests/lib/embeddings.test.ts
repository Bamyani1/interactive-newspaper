import { describe, it, expect } from "vitest";
import { buildEmbeddingText } from "@/src/lib/embeddings";

describe("buildEmbeddingText", () => {
  it("builds text with title and body prefix format", () => {
    const text = buildEmbeddingText({
      headline: "Test Headline",
      body_plain: "Some content",
      edition_date: "1960-01-13",
      category: "News",
    });

    expect(text).toContain("title: Test Headline");
    expect(text).toContain("text:");
    expect(text).toContain("Some content");
    expect(text).toContain("1960-01-13");
  });

  it("truncates body when total text exceeds MAX_EMBEDDING_CHARS", () => {
    const longBody = "x".repeat(40_000);
    const text = buildEmbeddingText({
      headline: "Short Headline",
      body_plain: longBody,
      edition_date: "1960-01-13",
      category: "News",
    });

    // Should be capped at 30,000 chars total
    expect(text.length).toBeLessThanOrEqual(30_000);
    // Should still contain the headline and preamble (not truncated from the front)
    expect(text).toContain("title: Short Headline");
    expect(text).toContain("1960-01-13");
  });

  it("does not truncate text under the limit", () => {
    const normalBody = "Normal article content about campus events.";
    const text = buildEmbeddingText({
      headline: "Normal Headline",
      body_plain: normalBody,
      edition_date: "1960-01-13",
      category: "News",
    });

    expect(text).toContain(normalBody);
  });
});
