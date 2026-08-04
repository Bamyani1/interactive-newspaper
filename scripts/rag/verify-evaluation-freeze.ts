import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sha256 } from "./snapshot-corpus";
import {
  DEV_DATASET_ID,
  verifyAcceptanceBands,
  type AcceptanceBandsFile,
  type FreezeCandidateReceipt,
} from "./lib/eval-records";

type JsonRecord = Record<string, unknown>;

interface DevelopmentQuestion {
  expectedSourceIdsAny?: string[];
  expectedSourceIdsAll?: string[];
  expectedSourceIdGroupsAll?: string[][];
}

interface DevelopmentCatalog {
  split: string;
  questions: DevelopmentQuestion[];
}

interface CorpusArticle {
  id: string;
  page: number;
  contentSha256: string;
  imageUrls?: string[];
}

interface CorpusSnapshot {
  corpusVersion: string;
  corpusSha256: string;
  databaseSnapshotSha256: string;
  editions: Array<{ date: string; articles: CorpusArticle[] }>;
}

interface InventoryRecord {
  sourceRecordId: string;
  date: string | null;
  manifest?: {
    sha256?: string;
    canvases?: Array<{ imageServiceId?: string }>;
  };
}

interface SourceInventory {
  inventorySha256: string;
  records: InventoryRecord[];
}

interface HoldoutSource {
  editionDate: string;
  page: number;
  contentSha256: string;
  sourceRecordId: string;
  manifestSha256: string;
  pageImageServiceId: string;
  spans: Record<string, string>;
  visuals?: Record<string, JsonRecord>;
}

interface HoldoutSourceRef {
  articleId: string;
  spanIds: string[];
  visualIds?: string[];
}

interface HoldoutQuestion {
  id: string;
  type: string[];
  conversationId?: string;
  turn?: number;
  dependsOn?: string;
  acceptableEvidenceGroups: Array<{ sourceRefs: HoldoutSourceRef[] }>;
  noAnswerCheckId?: string;
}

interface HoldoutCatalog {
  datasetId: string;
  split: string;
  status: string;
  corpusVersion: string;
  corpusSha256: string;
  databaseSnapshotSha256: string;
  sourceInventorySha256: string;
  developmentDataset: {
    fileSha256: string;
    sourceIdOverlapCount: number;
  };
  provenance: {
    comparisonRunsBeforeFreeze: number;
    candidateRetrieverObservedBeforeFreeze: boolean;
  };
  integrity: {
    holdoutSha256: string;
  };
  sources: Record<string, HoldoutSource>;
  noAnswerChecks: Record<string, JsonRecord>;
  questions: HoldoutQuestion[];
}

const REQUIRED_CASE_TYPES = [
  "exact_names",
  "exact_dates",
  "exact_numbers",
  "thematic_search",
  "multi_edition_synthesis",
  "visual_question",
  "date_filter",
  "no_answer",
  "exhaustive_enumeration",
  "multi_turn_followup",
  "prompt_injection_direct",
  "prompt_injection_indirect",
] as const;

export function computeHoldoutSha256(holdout: HoldoutCatalog): string {
  const integrity = { ...holdout.integrity } as Partial<HoldoutCatalog["integrity"]>;
  delete integrity.holdoutSha256;
  return sha256({ ...holdout, integrity });
}

export function fileSha256(contents: string | Buffer): string {
  return createHash("sha256").update(contents).digest("hex");
}

function developmentSourceIds(catalog: DevelopmentCatalog): Set<string> {
  const ids = new Set<string>();
  for (const question of catalog.questions) {
    for (const id of question.expectedSourceIdsAny ?? []) ids.add(id);
    for (const id of question.expectedSourceIdsAll ?? []) ids.add(id);
    for (const group of question.expectedSourceIdGroupsAll ?? []) {
      for (const id of group) ids.add(id);
    }
  }
  return ids;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function validateEvaluationFreeze(
  corpus: CorpusSnapshot,
  inventory: SourceInventory,
  development: DevelopmentCatalog,
  developmentFileSha256: string,
  holdout: HoldoutCatalog,
) {
  assert(development.split === "development", "Prior questions are not labeled development data.");
  assert(holdout.split === "holdout", "Evaluation catalog is not labeled holdout.");
  assert(holdout.status === "frozen_unrun", "Holdout must remain frozen and unrun at this gate.");
  assert(
    holdout.provenance.comparisonRunsBeforeFreeze === 0 &&
      holdout.provenance.candidateRetrieverObservedBeforeFreeze === false,
    "Holdout provenance indicates candidate-retriever leakage.",
  );
  assert(holdout.corpusVersion === corpus.corpusVersion, "Holdout corpus version mismatch.");
  assert(holdout.corpusSha256 === corpus.corpusSha256, "Holdout corpus hash mismatch.");
  assert(
    holdout.databaseSnapshotSha256 === corpus.databaseSnapshotSha256,
    "Holdout database snapshot hash mismatch.",
  );
  assert(
    holdout.sourceInventorySha256 === inventory.inventorySha256,
    "Holdout source-inventory hash mismatch.",
  );
  assert(
    holdout.developmentDataset.fileSha256 === developmentFileSha256,
    "Development-catalog file hash mismatch.",
  );
  assert(
    computeHoldoutSha256(holdout) === holdout.integrity.holdoutSha256,
    "Holdout integrity hash mismatch.",
  );

  const corpusArticles = new Map<string, { editionDate: string; article: CorpusArticle }>();
  for (const edition of corpus.editions) {
    for (const article of edition.articles) {
      corpusArticles.set(article.id, { editionDate: edition.date, article });
    }
  }
  const inventoryById = new Map(inventory.records.map((record) => [record.sourceRecordId, record]));
  const priorIds = developmentSourceIds(development);
  const overlap = Object.keys(holdout.sources).filter((id) => priorIds.has(id));
  assert(overlap.length === 0, `Holdout overlaps development sources: ${overlap.join(", ")}`);
  assert(
    holdout.developmentDataset.sourceIdOverlapCount === overlap.length,
    "Recorded development overlap count is incorrect.",
  );

  for (const [articleId, source] of Object.entries(holdout.sources)) {
    const corpusEntry = corpusArticles.get(articleId);
    assert(corpusEntry, `Holdout source ${articleId} is absent from the frozen corpus.`);
    assert(corpusEntry.editionDate === source.editionDate, `${articleId} edition-date mismatch.`);
    assert(corpusEntry.article.page === source.page, `${articleId} page mismatch.`);
    assert(
      corpusEntry.article.contentSha256 === source.contentSha256,
      `${articleId} content hash mismatch.`,
    );
    assert(Object.keys(source.spans).length > 0, `${articleId} has no frozen evidence spans.`);
    for (const [spanId, span] of Object.entries(source.spans)) {
      assert(span.trim().length > 0, `${articleId}.${spanId} is an empty evidence span.`);
    }

    const sourceRecord = inventoryById.get(source.sourceRecordId);
    assert(sourceRecord, `${articleId} source record is absent from the inventory.`);
    assert(sourceRecord.date === source.editionDate, `${articleId} source-record date mismatch.`);
    assert(
      sourceRecord.manifest?.sha256 === source.manifestSha256,
      `${articleId} manifest hash mismatch.`,
    );
    assert(
      sourceRecord.manifest?.canvases?.[source.page - 1]?.imageServiceId ===
        source.pageImageServiceId,
      `${articleId} IIIF page provenance mismatch.`,
    );

    for (const [visualId, visual] of Object.entries(source.visuals ?? {})) {
      assert(visual.scanVerified === true, `${articleId}.${visualId} was not scan-verified.`);
      if (typeof visual.registeredUrl === "string") {
        assert(
          corpusEntry.article.imageUrls?.includes(visual.registeredUrl),
          `${articleId}.${visualId} is not a registered article image.`,
        );
      }
      if (typeof visual.registeredCount === "number") {
        assert(
          (corpusEntry.article.imageUrls?.length ?? 0) >= visual.registeredCount,
          `${articleId}.${visualId} registered-image count exceeds the corpus record.`,
        );
      }
    }
  }

  const questionIds = new Set<string>();
  const observedTypes = new Set<string>();
  for (const question of holdout.questions) {
    assert(!questionIds.has(question.id), `Duplicate holdout question ID ${question.id}.`);
    questionIds.add(question.id);
    question.type.forEach((type) => observedTypes.add(type));
    for (const group of question.acceptableEvidenceGroups) {
      assert(group.sourceRefs.length > 0, `${question.id} has an empty evidence group.`);
      for (const ref of group.sourceRefs) {
        const source = holdout.sources[ref.articleId];
        assert(source, `${question.id} references unknown article ${ref.articleId}.`);
        for (const spanId of ref.spanIds) {
          assert(source.spans[spanId], `${question.id} references unknown span ${ref.articleId}.${spanId}.`);
        }
        for (const visualId of ref.visualIds ?? []) {
          assert(
            source.visuals?.[visualId],
            `${question.id} references unknown visual ${ref.articleId}.${visualId}.`,
          );
        }
      }
    }
    if (question.noAnswerCheckId) {
      assert(
        holdout.noAnswerChecks[question.noAnswerCheckId],
        `${question.id} references an unknown no-answer check.`,
      );
    }
    if (question.dependsOn) {
      assert(questionIds.has(question.dependsOn), `${question.id} dependency must appear first.`);
      assert(question.conversationId && question.turn && question.turn > 1, `${question.id} has invalid turn metadata.`);
    }
  }
  assert(holdout.questions.length >= 12, "Holdout is too small for the approved coverage matrix.");
  for (const type of REQUIRED_CASE_TYPES) {
    assert(observedTypes.has(type), `Holdout does not cover required case type ${type}.`);
  }

  return {
    datasetId: holdout.datasetId,
    holdoutSha256: holdout.integrity.holdoutSha256,
    corpusVersion: holdout.corpusVersion,
    sourceCount: Object.keys(holdout.sources).length,
    questionCount: holdout.questions.length,
    coveredCaseTypes: [...observedTypes].sort(),
    developmentSourceOverlapCount: overlap.length,
    status: holdout.status,
  };
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

export interface HoldoutScoringGateInput {
  bandsPath: string;
  candidateReceiptPath: string;
  /**
   * Canonical answersSha256 of the run file about to be scored, or null
   * for the pre-run form of the gate (run-eval checks bands + receipt
   * existence before asking any holdout question; the sha match is only
   * possible once a run file exists).
   */
  runFileSha: string | null;
}

/**
 * Holdout-scoring gate. Throws unless:
 *   (a) the acceptance-bands file exists, passes its self-hash, and was
 *       locked on the development dataset (rag-development-v1); and
 *   (b) the frozen candidate receipt exists and — when runFileSha is
 *       provided — its answersSha256 matches it exactly.
 */
export function assertHoldoutScoringAllowed(input: HoldoutScoringGateInput): {
  bandsBasedOnRunId: string;
  receiptRunId: string;
  answersSha256: string;
} {
  const bandsPath = path.resolve(input.bandsPath);
  assert(
    existsSync(bandsPath),
    `Holdout scoring blocked: acceptance-bands file ${bandsPath} does not exist.`,
  );
  const bands = readJson<AcceptanceBandsFile>(bandsPath);
  const bandsCheck = verifyAcceptanceBands(bands);
  assert(
    bandsCheck.ok,
    `Holdout scoring blocked: acceptance bands failed self-hash verification (expected ${bandsCheck.expected}, actual ${bandsCheck.actual}).`,
  );
  assert(
    bands.datasetId === DEV_DATASET_ID &&
      typeof bands.basedOnRunId === "string" &&
      bands.basedOnRunId.length > 0,
    `Holdout scoring blocked: acceptance bands must be locked on the ${DEV_DATASET_ID} development dataset.`,
  );

  const receiptPath = path.resolve(input.candidateReceiptPath);
  assert(
    existsSync(receiptPath),
    `Holdout scoring blocked: frozen candidate receipt ${receiptPath} does not exist.`,
  );
  const receipt = readJson<FreezeCandidateReceipt>(receiptPath);
  assert(
    typeof receipt.answersSha256 === "string" &&
      /^[0-9a-f]{64}$/.test(receipt.answersSha256) &&
      typeof receipt.runId === "string" &&
      receipt.runId.length > 0,
    "Holdout scoring blocked: candidate receipt is malformed.",
  );
  if (input.runFileSha !== null) {
    assert(
      receipt.answersSha256 === input.runFileSha,
      `Holdout scoring blocked: candidate receipt answersSha256 ${receipt.answersSha256} does not match the run file's answer set ${input.runFileSha}.`,
    );
  }
  return {
    bandsBasedOnRunId: bands.basedOnRunId,
    receiptRunId: receipt.runId,
    answersSha256: receipt.answersSha256,
  };
}

function argValue(argv: string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  if (index === -1 || index + 1 >= argv.length) return null;
  return argv[index + 1];
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--check-holdout-gate")) {
    const bandsPath = argValue(argv, "--bands");
    const candidateReceiptPath = argValue(argv, "--receipt");
    assert(
      bandsPath && candidateReceiptPath,
      "--check-holdout-gate requires --bands <path> and --receipt <path>.",
    );
    const result = assertHoldoutScoringAllowed({
      bandsPath,
      candidateReceiptPath,
      runFileSha: argValue(argv, "--run-file-sha"),
    });
    console.log(JSON.stringify({ holdoutScoringAllowed: true, ...result }, null, 2));
    return;
  }
  const corpusPath = path.resolve("evaluation/rag/corpus/legacy-8b8207373510d69e.json");
  const inventoryPath = path.resolve(
    "evaluation/rag/source-inventory/contentdm-p15963coll9-6a9d9286b30620f7.json",
  );
  const developmentPath = path.resolve("tests/api/rag-golden-questions.json");
  const holdoutPath = path.resolve("evaluation/rag/holdout/rag-holdout-v1.json");
  const developmentContents = readFileSync(developmentPath);
  const result = validateEvaluationFreeze(
    readJson<CorpusSnapshot>(corpusPath),
    readJson<SourceInventory>(inventoryPath),
    JSON.parse(developmentContents.toString("utf8")) as DevelopmentCatalog,
    fileSha256(developmentContents),
    readJson<HoldoutCatalog>(holdoutPath),
  );
  console.log(JSON.stringify(result, null, 2));
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
