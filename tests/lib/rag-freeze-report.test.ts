import { describe, expect, it } from "vitest";
import {
  buildDataLineageCatalog,
  buildFreezeReport,
} from "../../scripts/rag/build-freeze-report";

function corpusFixture() {
  return {
    schemaVersion: 2,
    corpusVersion: "legacy-test",
    corpusSha256: "content-hash",
    databaseSnapshotSha256: "database-hash",
    schemaSha256: "schema-hash",
    tableNames: ["articles", "editions", "ads"],
    schema: [
      { table_name: "articles", column_name: "id" },
      { table_name: "articles", column_name: "embedding_model" },
    ],
    counts: {
      editions: 2,
      articles: 2,
      ads: 1,
      articlesWithImages: 1,
      articleImageReferences: 1,
    },
    embeddingCoverage: {
      currentModel: "gemini-embedding-2",
      articleCurrentModelEmbeddings: 0,
      articleModels: { "gemini-embedding-2-preview": 2 },
    },
    editions: [
      {
        date: "1960-01-01",
        pageCount: 8,
        articles: [{ id: "1960-01-01-0", page: 8, imageUrls: ["image.webp"] }],
        ads: [],
      },
      {
        date: "1970-01-01",
        pageCount: 6,
        articles: [{ id: "1970-01-01-0", page: 6, imageUrls: [] }],
        ads: [{}],
      },
    ],
  };
}

function sourceFixture() {
  return {
    schemaVersion: 1,
    inventorySha256: "source-hash",
    corpusVersion: "legacy-test",
    apiTotals: {
      matchingParentOrRootRecords: 3,
      matchingRecordsIncludingCompoundPages: 30,
    },
    counts: {
      activeUnmatchedDates: 0,
      activeCollisionDates: 0,
    },
    records: [
      {
        sourceRecordId: "contentdm:test:1",
        pointer: 1,
        date: "1960-01-01",
        classification: "issue_candidate",
        activeCorpusDate: true,
        reviewFlags: [],
        manifest: { status: "ok" as const, sha256: "manifest-1", canvasCount: 8 },
      },
      {
        sourceRecordId: "contentdm:test:2",
        pointer: 2,
        date: "1970-01-01",
        classification: "issue_candidate",
        activeCorpusDate: true,
        reviewFlags: [],
        manifest: { status: "ok" as const, sha256: "manifest-2", canvasCount: 12 },
      },
      {
        sourceRecordId: "contentdm:test:3",
        pointer: 3,
        date: "1980-01-01",
        classification: "ambiguous_compound",
        activeCorpusDate: false,
        reviewFlags: [],
        manifest: { status: "not_fetched" as const },
      },
    ],
  };
}

describe("RAG freeze report", () => {
  it("records the vector-label mismatch without treating it as missing text", () => {
    const report = buildFreezeReport(corpusFixture(), sourceFixture());

    expect(report.retrievalBaseline).toMatchObject({
      vectorsUsableByConfiguredModel: 0,
      effectiveState: "lexical_only_until_controlled_backfill",
      candidateChunkTablePresent: false,
      candidateImageTablePresent: false,
    });
    expect(report.corpus.counts.articles).toBe(2);
  });

  it("labels the legacy page count comparison as a proxy", () => {
    const report = buildFreezeReport(corpusFixture(), sourceFixture());

    expect(report.pageMetadataAudit.exactManifestCount).toBe(1);
    expect(report.pageMetadataAudit.legacyUndercount).toBe(1);
    expect(report.pageMetadataAudit.belowSeventyPercentProxyDates).toEqual([
      "1970-01-01",
    ]);
    expect(report.pageMetadataAudit.interpretation).toContain("cannot prove OCR");
  });

  it("fails closed when source and corpus versions differ", () => {
    const source = sourceFixture();
    source.corpusVersion = "different";
    expect(() => buildFreezeReport(corpusFixture(), source)).toThrow(
      /Corpus\/source mismatch/,
    );
  });

  it("marks private and unused database datasets explicitly", () => {
    const lineage = buildDataLineageCatalog(corpusFixture(), sourceFixture());
    expect(
      lineage.datasets.find((dataset) => dataset.id === "ask_session_turns"),
    ).toMatchObject({ privacyClass: "private_user_content" });
    expect(
      lineage.datasets.find((dataset) => dataset.id === "weather_music"),
    ).toMatchObject({ ragUsage: "unused" });
    expect(lineage.lineageSha256).toMatch(/^[a-f0-9]{64}$/);
  });
});
