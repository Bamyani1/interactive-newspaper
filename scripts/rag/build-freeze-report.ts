import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sha256, stableStringify } from "./snapshot-corpus";

type JsonRecord = Record<string, unknown>;

interface CorpusArticle {
  id: string;
  page: number;
  imageUrls?: string[];
}

interface CorpusEdition {
  date: string;
  pageCount: number;
  articles: CorpusArticle[];
  ads?: unknown[];
}

interface CorpusSnapshot {
  schemaVersion: number;
  corpusVersion: string;
  corpusSha256: string;
  databaseSnapshotSha256: string;
  schemaSha256: string;
  tableNames: string[];
  schema: Array<{ table_name?: string; column_name?: string }>;
  counts: Record<string, number>;
  embeddingCoverage: {
    currentModel: string;
    articleCurrentModelEmbeddings: number;
    articleModels: Record<string, number>;
  };
  editions: CorpusEdition[];
}

interface SourceRecord {
  sourceRecordId: string;
  pointer: number;
  date: string | null;
  classification: string;
  activeCorpusDate: boolean;
  reviewFlags: string[];
  manifest?: {
    status: "ok" | "failed" | "not_fetched";
    sha256?: string;
    canvasCount?: number;
  };
}

interface SourceInventory {
  schemaVersion: number;
  inventorySha256: string;
  corpusVersion: string | null;
  apiTotals: Record<string, number>;
  counts: JsonRecord;
  records: SourceRecord[];
}

function decadeFor(date: string): string {
  return `${date.slice(0, 3)}0s`;
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function countColumns(
  schema: CorpusSnapshot["schema"],
  table: string,
): Set<string> {
  return new Set(
    schema
      .filter((column) => column.table_name === table)
      .map((column) => String(column.column_name ?? "")),
  );
}

export function buildDataLineageCatalog(
  corpus: CorpusSnapshot,
  source: SourceInventory,
) {
  const immutable = {
    schemaVersion: 1,
    corpusVersion: corpus.corpusVersion,
    sourceInventorySha256: source.inventorySha256,
    datasets: [
      {
        id: "contentdm_issue_metadata",
        authority: "OCLC CONTENTdm p15963coll9 metadata and IIIF manifests",
        transformations: ["exact source filter", "record classification", "active-date manifest inventory"],
        fieldConsumers: ["source discovery", "expected page count", "source pointer provenance"],
        revisionRule: "identify by collection, pointer, and manifest SHA-256; never choose date collisions automatically",
        retention: "durable public provenance metadata",
        privacyClass: "public",
      },
      {
        id: "editions",
        authority: "published OCR archive edition records",
        transformations: ["OCR assembly", "legacy database publication"],
        fieldConsumers: ["archive browsing", "RAG date filters", "agent list_editions"],
        revisionRule: "legacy rows are mutable; future publication must pin an immutable content revision",
        retention: "durable public archive record",
        privacyClass: "public",
        ragUsage: "direct",
      },
      {
        id: "articles",
        authority: "published OCR article records",
        transformations: ["page structuring", "continuation merge", "schema adapter", "legacy article embedding"],
        fieldConsumers: ["FTS", "vector retrieval", "reranking", "answers", "citations", "article hydration"],
        revisionRule: "legacy IDs are date/position based; future identities must be stable and revision-pinned",
        retention: "durable public archive record",
        privacyClass: "public",
        ragUsage: "direct",
      },
      {
        id: "ads",
        authority: "published OCR advertisement records",
        transformations: ["OCR ad extraction", "legacy database publication"],
        fieldConsumers: ["edition display"],
        revisionRule: "preserve in archive model; exclude from default RAG rollout",
        retention: "durable public archive record",
        privacyClass: "public",
        ragUsage: "excluded_by_policy",
      },
      {
        id: "article_images_legacy",
        authority: "article image URL and caption arrays plus R2 derivatives",
        transformations: ["visual-region crop", "WebP derivative", "article association"],
        fieldConsumers: ["edition display", "visual retrieval filter", "answer image rendering"],
        revisionRule: "legacy date paths remain readable; future assets are content-addressed and revision-pinned",
        retention: "durable derivative; original source page remains re-downloadable",
        privacyClass: "public",
        ragUsage: "direct_legacy_metadata",
      },
      {
        id: "weather_music",
        authority: "derived contextual archive datasets",
        transformations: ["separate archive-data import"],
        fieldConsumers: ["edition experience outside /ask"],
        revisionRule: "version independently from newspaper corpus",
        retention: "durable contextual data",
        privacyClass: "public",
        ragUsage: "unused",
      },
      {
        id: "entities_article_entities",
        authority: "derived entity index",
        transformations: ["legacy entity extraction"],
        fieldConsumers: [],
        revisionRule: "do not assume coverage or activate without an evaluated consumer",
        retention: "review before future migration",
        privacyClass: "public_derived",
        ragUsage: "unused",
      },
      {
        id: "ask_session_turns",
        authority: "user conversation activity",
        transformations: ["answer truncation", "citation ID storage"],
        fieldConsumers: ["multi-turn context", "session hydration"],
        revisionRule: "ephemeral; evaluation mode must not persist rows",
        retention: "30-minute application TTL with explicit deletion support",
        privacyClass: "private_user_content",
        ragUsage: "operational",
      },
      {
        id: "ask_feedback",
        authority: "user-submitted answer feedback",
        transformations: ["validation", "citation JSON storage"],
        fieldConsumers: ["quality review"],
        revisionRule: "append-only feedback; evaluation mode must not persist rows",
        retention: "requires explicit privacy retention policy",
        privacyClass: "private_user_content",
        ragUsage: "evaluation_signal_only",
      },
      {
        id: "ai_spend_counter_api_rate_bucket",
        authority: "application operational telemetry",
        transformations: ["cost aggregation", "rate-limit bucket aggregation"],
        fieldConsumers: ["online spend guard", "rate limiting"],
        revisionRule: "online and offline evaluation ledgers must remain separate",
        retention: "operational policy",
        privacyClass: "operational_metadata",
        ragUsage: "operational",
      },
    ],
  };
  return {
    ...immutable,
    lineageSha256: sha256(immutable),
  };
}

export function buildFreezeReport(
  corpus: CorpusSnapshot,
  source: SourceInventory,
) {
  if (source.corpusVersion !== corpus.corpusVersion) {
    throw new Error(
      `Corpus/source mismatch: ${corpus.corpusVersion} != ${source.corpusVersion}.`,
    );
  }

  const activeSourceByDate = new Map<string, SourceRecord[]>();
  for (const record of source.records) {
    if (!record.activeCorpusDate || !record.date) continue;
    const group = activeSourceByDate.get(record.date) ?? [];
    group.push(record);
    activeSourceByDate.set(record.date, group);
  }

  const pageCoverage = corpus.editions.map((edition) => {
    const sourceRecords = activeSourceByDate.get(edition.date) ?? [];
    const sourceRecord = sourceRecords.length === 1 ? sourceRecords[0] : null;
    const expectedPages = sourceRecord?.manifest?.canvasCount ?? null;
    const legacyDerivedPageCount = edition.pageCount;
    const ratio = expectedPages && expectedPages > 0
      ? legacyDerivedPageCount / expectedPages
      : null;
    const state = expectedPages === null
      ? "unknown"
      : legacyDerivedPageCount === expectedPages
        ? "equal"
        : legacyDerivedPageCount < expectedPages
          ? "legacy_undercount"
          : "legacy_overcount";
    return {
      date: edition.date,
      sourceRecordId: sourceRecord?.sourceRecordId ?? null,
      sourcePointer: sourceRecord?.pointer ?? null,
      manifestSha256: sourceRecord?.manifest?.sha256 ?? null,
      expectedManifestPages: expectedPages,
      legacyDerivedPageCount,
      legacyPageCountRatio: ratio === null ? null : round(ratio),
      comparisonState: state,
      belowSeventyPercentProxy: ratio !== null && ratio < 0.7,
      articleCount: edition.articles.length,
      adCount: edition.ads?.length ?? 0,
      imageReferenceCount: edition.articles.reduce(
        (sum, article) => sum + (article.imageUrls?.length ?? 0),
        0,
      ),
      caveat:
        "Legacy page_count is derived from article source pages; it is not an authoritative processed-page ledger.",
    };
  });

  const allDates = source.records
    .map((record) => record.date)
    .filter((date): date is string => Boolean(date));
  const decades = new Set([
    ...allDates.map(decadeFor),
    ...corpus.editions.map((edition) => decadeFor(edition.date)),
  ]);
  const coverageByDecade = [...decades].sort().map((decade) => {
    const prefix = decade.slice(0, 3);
    const sourceRecords = source.records.filter(
      (record) => record.date?.startsWith(prefix),
    );
    const activeEditions = corpus.editions.filter((edition) =>
      edition.date.startsWith(prefix),
    );
    return {
      decade,
      discoveredRootRecords: sourceRecords.length,
      issueCandidates: sourceRecords.filter(
        (record) => record.classification === "issue_candidate",
      ).length,
      ambiguousRecords: sourceRecords.filter(
        (record) => record.classification.startsWith("ambiguous"),
      ).length,
      databaseActiveEditions: activeEditions.length,
      ragIndexedEditions: activeEditions.filter((edition) => edition.articles.length > 0).length,
      editionsWithImageReferences: activeEditions.filter((edition) =>
        edition.articles.some((article) => (article.imageUrls?.length ?? 0) > 0),
      ).length,
    };
  });

  const articleColumns = countColumns(corpus.schema, "articles");
  const exactPages = pageCoverage.filter((item) => item.comparisonState === "equal").length;
  const underPages = pageCoverage.filter(
    (item) => item.comparisonState === "legacy_undercount",
  ).length;
  const overPages = pageCoverage.filter(
    (item) => item.comparisonState === "legacy_overcount",
  ).length;
  const belowThreshold = pageCoverage.filter((item) => item.belowSeventyPercentProxy);
  const reportCore = {
    schemaVersion: 1,
    corpus: {
      version: corpus.corpusVersion,
      contentSha256: corpus.corpusSha256,
      databaseSnapshotSha256: corpus.databaseSnapshotSha256,
      schemaSha256: corpus.schemaSha256,
      counts: corpus.counts,
    },
    source: {
      inventorySha256: source.inventorySha256,
      apiTotals: source.apiTotals,
      counts: source.counts,
    },
    retrievalBaseline: {
      configuredEmbeddingModel: corpus.embeddingCoverage.currentModel,
      vectorsUsableByConfiguredModel:
        corpus.embeddingCoverage.articleCurrentModelEmbeddings,
      storedArticleEmbeddingModels: corpus.embeddingCoverage.articleModels,
      effectiveState:
        corpus.embeddingCoverage.articleCurrentModelEmbeddings === 0
          ? "lexical_only_until_controlled_backfill"
          : "hybrid_capable",
      candidateChunkTablePresent: corpus.tableNames.includes("article_chunks"),
      candidateImageTablePresent: corpus.tableNames.includes("article_images"),
      articleEmbeddingInputHashPresent: articleColumns.has("embedding_input_hash"),
      articleEmbeddingInputVersionPresent: articleColumns.has("embedding_input_version"),
    },
    pageMetadataAudit: {
      exactManifestCount: exactPages,
      legacyUndercount: underPages,
      legacyOvercount: overPages,
      unknown: pageCoverage.length - exactPages - underPages - overPages,
      belowSeventyPercentProxyDates: belowThreshold.map((item) => item.date),
      interpretation:
        "This compares the legacy article-derived page_count with IIIF canvases. It cannot prove OCR page success or failure because the legacy schema has no processed/failed page ledger.",
      editions: pageCoverage,
    },
    coverageByDecade,
    databaseUsage: {
      directRagContent: ["articles", "editions"],
      excludedFromDefaultRag: ["ads"],
      unusedByCurrentRag: ["article_entities", "entities", "music", "weather"],
      operationalOnly: ["ai_spend_counter", "api_rate_bucket", "ask_feedback", "ask_session_turns"],
      candidateTablesAbsent: ["article_chunks", "article_images"].filter(
        (table) => !corpus.tableNames.includes(table),
      ),
    },
    gates: {
      sourceInventoryFrozen: true,
      corpusFrozen: true,
      activeDatesUniquelyMapped:
        Number(source.counts.activeUnmatchedDates ?? 0) === 0 &&
        Number(source.counts.activeCollisionDates ?? 0) === 0,
      configuredVectorCoverageComplete:
        corpus.embeddingCoverage.articleCurrentModelEmbeddings === corpus.counts.articles,
      authoritativePageOutcomeLedgerPresent: false,
      holdoutFrozen: false,
      comparisonRunAllowed: false,
    },
  };
  return {
    ...reportCore,
    freezeReportSha256: sha256(reportCore),
  };
}

function writeImmutable(
  filePath: string,
  contents: string,
  expectedHash: string,
  hashField: "freezeReportSha256" | "lineageSha256",
): "created" | "reused" {
  mkdirSync(path.dirname(filePath), { recursive: true });
  if (existsSync(filePath)) {
    const existing = readFileSync(filePath, "utf8");
    if (filePath.endsWith(".json")) {
      const parsed = JSON.parse(existing) as Record<string, unknown>;
      if (parsed[hashField] === expectedHash) return "reused";
    } else if (existing === contents) {
      return "reused";
    }
    throw new Error(`Refusing to overwrite immutable artifact ${filePath}.`);
  }
  const partial = `${filePath}.part`;
  writeFileSync(partial, contents, "utf8");
  renameSync(partial, filePath);
  return "created";
}

function parseArgs(argv: string[]) {
  const options = { corpus: "", source: "", outputDir: path.resolve("evaluation/rag/freeze") };
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    const next = argv[index + 1];
    if (value === "--corpus" && next) options.corpus = path.resolve(next), index++;
    else if (value === "--source" && next) options.source = path.resolve(next), index++;
    else if (value === "--output-dir" && next) options.outputDir = path.resolve(next), index++;
    else throw new Error(`Unknown or incomplete argument: ${value}`);
  }
  if (!options.corpus || !options.source) {
    throw new Error("--corpus and --source are required.");
  }
  return options;
}

function markdownReport(report: ReturnType<typeof buildFreezeReport>): string {
  const pageAudit = report.pageMetadataAudit;
  const below = pageAudit.editions.filter((edition) => edition.belowSeventyPercentProxy);
  return [
    "# RAG Source and Corpus Freeze",
    "",
    `- Corpus version: \`${report.corpus.version}\``,
    `- Corpus content hash: \`${report.corpus.contentSha256}\``,
    `- Database snapshot hash: \`${report.corpus.databaseSnapshotSha256}\``,
    `- Source inventory hash: \`${report.source.inventorySha256}\``,
    `- Freeze report hash: \`${report.freezeReportSha256}\``,
    "",
    "## Verified baseline",
    "",
    `- ${report.corpus.counts.editions} editions, ${report.corpus.counts.articles} articles, and ${report.corpus.counts.ads} ads are frozen.`,
    `- ${report.source.apiTotals.matchingParentOrRootRecords} matching parent/root records and ${report.source.apiTotals.matchingRecordsIncludingCompoundPages} records including child pages were inventoried.`,
    `- ${report.retrievalBaseline.vectorsUsableByConfiguredModel}/${report.corpus.counts.articles} article vectors are labeled for \`${report.retrievalBaseline.configuredEmbeddingModel}\`.`,
    `- Effective current retrieval state: \`${report.retrievalBaseline.effectiveState}\`.`,
    `- Legacy article assets reference ${report.corpus.counts.articleImageReferences} images across ${report.corpus.counts.articlesWithImages} articles.`,
    "",
    "## Page metadata audit",
    "",
    `- Exact legacy page count vs IIIF canvas count: ${pageAudit.exactManifestCount}.`,
    `- Legacy undercounts: ${pageAudit.legacyUndercount}; overcounts: ${pageAudit.legacyOvercount}.`,
    `- Below the 70% proxy: ${below.length}${below.length ? ` (${below.map((item) => item.date).join(", ")})` : ""}.`,
    `- Caveat: ${pageAudit.interpretation}`,
    "",
    "## Database use by `/ask`",
    "",
    `- Direct content: ${report.databaseUsage.directRagContent.join(", ")}.`,
    `- Excluded by rollout policy: ${report.databaseUsage.excludedFromDefaultRag.join(", ")}.`,
    `- Present but unused by current RAG: ${report.databaseUsage.unusedByCurrentRag.join(", ")}.`,
    `- Operational only: ${report.databaseUsage.operationalOnly.join(", ")}.`,
    "",
    "The freeze does not authorize a backfill or production mutation. The evaluation holdout must be frozen before a comparison run.",
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const corpus = JSON.parse(readFileSync(options.corpus, "utf8")) as CorpusSnapshot;
  const source = JSON.parse(readFileSync(options.source, "utf8")) as SourceInventory;
  const report = buildFreezeReport(corpus, source);
  const lineage = buildDataLineageCatalog(corpus, source);
  const reportBase = `freeze-${corpus.corpusVersion}-${report.freezeReportSha256.slice(0, 16)}`;
  const lineageBase = `lineage-${corpus.corpusVersion}-${lineage.lineageSha256.slice(0, 16)}`;
  const reportJsonPath = path.join(options.outputDir, `${reportBase}.json`);
  const reportMdPath = path.join(options.outputDir, `${reportBase}.md`);
  const lineagePath = path.join(options.outputDir, `${lineageBase}.json`);
  const dispositions = {
    reportJson: writeImmutable(
      reportJsonPath,
      `${JSON.stringify({ ...report, generatedAt: new Date().toISOString() }, null, 2)}\n`,
      report.freezeReportSha256,
      "freezeReportSha256",
    ),
    reportMarkdown: writeImmutable(
      reportMdPath,
      markdownReport(report),
      report.freezeReportSha256,
      "freezeReportSha256",
    ),
    lineage: writeImmutable(
      lineagePath,
      `${JSON.stringify({ ...lineage, generatedAt: new Date().toISOString() }, null, 2)}\n`,
      lineage.lineageSha256,
      "lineageSha256",
    ),
  };
  console.log(JSON.stringify({ reportJsonPath, reportMdPath, lineagePath, dispositions }, null, 2));
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

export { stableStringify };
