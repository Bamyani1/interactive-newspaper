import { describe, expect, it, vi } from "vitest";
import {
  buildCorpusSnapshot,
  sha256,
  stableStringify,
} from "../../scripts/rag/snapshot-corpus";

function fixture() {
  return {
    transaction: { snapshot_at: "2026-08-02", transaction_snapshot: "1:2:" },
    schema: [{ table_name: "articles", ordinal_position: 1, column_name: "id" }],
    tableNames: ["ads", "articles", "editions"],
    editions: [
      { date: "1960-01-13", publication_info: "Vol. 93", page_count: 12, article_count: 2 },
    ],
    articles: [
      {
        id: "1960-01-13-1",
        edition_date: "1960-01-13",
        position: 1,
        category: "News",
        headline: "Second",
        summary: "",
        full_text: "<p>B</p>",
        body_plain: "B",
        byline: null,
        writer_position: null,
        page: 2,
        is_hero: false,
        is_featured: false,
        image_urls: [],
        image_caption: null,
        image_captions: [],
        embedding_model: "gemini-embedding-2",
        embedding_input_hash: "b",
        embedding_input_version: "v1",
        has_embedding: true,
      },
      {
        id: "1960-01-13-0",
        edition_date: "1960-01-13",
        position: 0,
        category: "News",
        headline: "First",
        summary: "",
        full_text: "<p>A</p>",
        body_plain: "A",
        byline: null,
        writer_position: null,
        page: 1,
        is_hero: true,
        is_featured: true,
        image_urls: [],
        image_caption: null,
        image_captions: [],
        embedding_model: "gemini-embedding-2",
        embedding_input_hash: "a",
        embedding_input_version: "v1",
        has_embedding: true,
      },
    ],
    ads: [],
    weather: [{ rows: 1, min_date: "1960-01-13", max_date: "1960-01-13", estimated_rows: 0 }],
    music: [{ rows: 10, min_year: 1960, max_year: 1960, months: 1 }],
    chunks: [],
    images: [],
  };
}

describe("corpus snapshot", () => {
  it("stable-stringifies object keys deterministically", () => {
    expect(stableStringify({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(sha256({ b: 2, a: 1 })).toBe(sha256({ a: 1, b: 2 }));
  });

  it("orders content by stored position and excludes generation time from corpus identity", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-02T00:00:00Z"));
      const first = buildCorpusSnapshot(fixture());
      vi.setSystemTime(new Date("2026-08-03T00:00:00Z"));
      const second = buildCorpusSnapshot(fixture());
      expect(first.editions[0].articles.map((article) => article.id)).toEqual([
        "1960-01-13-0",
        "1960-01-13-1",
      ]);
      expect(first.corpusSha256).toBe(second.corpusSha256);
      expect(first.generatedAt).not.toBe(second.generatedAt);
    } finally {
      vi.useRealTimers();
    }
  });

  it("changes corpus identity when retrievable text changes", () => {
    const original = buildCorpusSnapshot(fixture());
    const changedInput = fixture();
    changedInput.articles[0].body_plain = "changed";
    const changed = buildCorpusSnapshot(changedInput);
    expect(changed.corpusSha256).not.toBe(original.corpusSha256);
  });

  it("keeps content identity stable across an embedding-model backfill", () => {
    const original = buildCorpusSnapshot(fixture());
    const reembeddedInput = fixture();
    reembeddedInput.articles[0].embedding_model = "replacement-model";
    reembeddedInput.articles[0].embedding_input_hash = "replacement-hash";
    const reembedded = buildCorpusSnapshot(reembeddedInput);

    expect(reembedded.corpusSha256).toBe(original.corpusSha256);
    expect(reembedded.databaseSnapshotSha256).not.toBe(
      original.databaseSnapshotSha256,
    );
  });
});
