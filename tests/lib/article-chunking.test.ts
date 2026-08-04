import { describe, expect, it } from "vitest";
import {
  buildArticleChunkRecords,
  chunkArticleBody,
} from "@/src/lib/article-chunking";

describe("article chunking", () => {
  it("is deterministic and retains complete sentence overlap", () => {
    const sentences = Array.from(
      { length: 12 },
      (_, index) => `Sentence ${index + 1} contains archival context and ends cleanly.`,
    );
    const body = sentences.join(" ");
    const first = chunkArticleBody(body, 190, 80);
    const second = chunkArticleBody(body, 190, 80);

    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(2);
    for (let index = 1; index < first.length; index += 1) {
      const priorLastSentence = first[index - 1].match(/Sentence \d+[^.]*\.$/u)?.[0];
      expect(priorLastSentence).toBeDefined();
      expect(first[index]).toContain(priorLastSentence!);
    }
  });

  it("splits an overlong sentence at a nearby word boundary", () => {
    const chunks = chunkArticleBody(`Lead ${"word ".repeat(200)}end.`, 180, 40);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 230)).toBe(true);
    expect(chunks.join(" ")).not.toContain("  ");
  });

  it("produces stable IDs, canonical inputs, and hashes", () => {
    const article = {
      id: "1965-03-15-4",
      headline: "Campus Event",
      byline: "By A. Reporter",
      body_plain: "First sentence. Second sentence.",
      edition_date: "1965-03-15",
      category: "News",
      summary: "A summary.",
    };
    const records = buildArticleChunkRecords(article);
    expect(records[0].id).toBe("1965-03-15-4:0000");
    expect(records[0].embeddingInput.text).toContain("title: Campus Event");
    expect(records[0].embeddingInputHash).toMatch(/^[a-f0-9]{64}$/);
    expect(buildArticleChunkRecords(article)).toEqual(records);
    expect(
      buildArticleChunkRecords({ ...article, body_plain: `${article.body_plain} New.` })[0]
        .embeddingInputHash,
    ).not.toBe(records[0].embeddingInputHash);
  });
});
