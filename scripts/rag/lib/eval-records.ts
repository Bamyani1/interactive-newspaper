/**
 * Shared evaluation record schema for the RAG live-evaluation harness.
 *
 * Both the runner (scripts/rag/run-eval.ts) and the scorer
 * (scripts/rag/score-eval.ts) speak this format. The file is deliberately
 * self-contained (node:crypto only) so tests can import it without pulling
 * database drivers into the module graph.
 *
 * Self-hashing mirrors the documented recipe of
 * scripts/db/bootstrap-asset-registry.mjs: a canonical JSON serialization
 * with a fixed top-level field order and volatile fields nulled, hashed
 * with sha256. See RUN_FILE_HASH_RECIPE / BANDS_HASH_RECIPE.
 */

import { createHash } from "node:crypto";

export const DEV_DATASET_ID = "rag-development-v1";

// ─── Record shapes ──────────────────────────────────────────────

export type EvalStageStatus = "ok" | "skipped" | "error" | "unavailable";

/**
 * Bounded structured capture for one pipeline stage. Never contains raw
 * prompts; `detail` is limited to small structured observables taken from
 * the /api/ask response envelope. `rankedSourceIds` is populated only for
 * the rerank stage (the final ranked article-id order the route returned).
 */
export interface EvalStageCapture {
    status: EvalStageStatus;
    ms: number | null;
    summary?: string;
    detail?: Record<string, unknown>;
    rankedSourceIds?: string[];
}

export interface EvalRunStages {
    reformulation: EvalStageCapture;
    ftsRaw: EvalStageCapture;
    vectorRaw: EvalStageCapture;
    fusion: EvalStageCapture;
    rerank: EvalStageCapture;
    coverage: EvalStageCapture;
}

export interface EvalRunConfig {
    retrievalMode: "legacy" | "shadow" | "versioned";
    indexBuildId: string | null;
    corpusVersion: string;
    pipelineVersion: string;
}

export interface EvalAnswerCapture {
    text: string;
    /** Cited article ids, in citation order. */
    citations: string[];
    /** Image URLs attached to cited articles (deduplicated). */
    images: string[];
    confidence: "low" | "medium" | "high" | null;
    followUps: string[];
}

export interface EvalRecordError {
    status: number;
    kind: string | null;
    message: string;
}

export interface EvalRunRecord {
    runId: string;
    datasetId: string;
    split: string;
    questionId: string;
    turn: number;
    config: EvalRunConfig;
    stages: EvalRunStages;
    answer: EvalAnswerCapture;
    timings: {
        perStageMs: Record<string, number | null>;
        totalMs: number;
    };
    /**
     * Token usage. The /api/ask response envelope currently exposes no
     * token counts, so the runner records nulls; the field exists so the
     * schema does not have to change when the envelope grows usage data.
     */
    tokens: {
        input: number | null;
        output: number | null;
        thought: number | null;
    };
    retries: number;
    fallbackPath: string | null;
    /**
     * Cost attributed to this question. The /api/ask envelope currently
     * exposes no cost field, so this is null unless the caller supplied an
     * assumed per-question cost; documented gap, not an invented number.
     */
    costUsd: number | null;
    error?: EvalRecordError | null;
}

export interface EvalRunTotals {
    questionCount: number;
    errorCount: number;
    totalMs: number;
    totalCostUsd: number;
    tokens: { input: number; output: number; thought: number };
}

export interface EvalRunFile {
    schemaVersion: 1;
    runId: string;
    datasetId: string;
    split: string;
    config: EvalRunConfig;
    /** Stamped by the caller when writing; nulled for self-hashing. */
    startedAt: string | null;
    records: EvalRunRecord[];
    totals: EvalRunTotals;
    selfSha256: string | null;
}

// ─── Canonical hashing ──────────────────────────────────────────

export function sha256Hex(text: string): string {
    return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Recursively sort object keys so the canonical serialization does not
 * depend on construction order. Arrays keep their order (record order is
 * part of a run's identity). `undefined` object values are dropped, which
 * matches JSON.stringify behavior.
 */
export function deepSortKeys(value: unknown): unknown {
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map((entry) => deepSortKeys(entry));
    const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return Object.fromEntries(
        entries.map(([key, entry]) => [key, deepSortKeys(entry)]),
    );
}

export const RUN_FILE_HASH_RECIPE =
    "sha256 hex digest of JSON.stringify(canonical, null, 2) where canonical is the run file " +
    "with fields in the fixed order {schemaVersion, runId, datasetId, split, config, startedAt, " +
    "records, totals, selfSha256}, the volatile startedAt and selfSha256 both replaced by null, " +
    "and every nested object's keys sorted lexicographically (arrays keep their order)";

export function canonicalRunFileJson(runFile: EvalRunFile): string {
    return JSON.stringify(
        {
            schemaVersion: runFile.schemaVersion,
            runId: runFile.runId,
            datasetId: runFile.datasetId,
            split: runFile.split,
            config: deepSortKeys(runFile.config),
            startedAt: null,
            records: deepSortKeys(runFile.records),
            totals: deepSortKeys(runFile.totals),
            selfSha256: null,
        },
        null,
        2,
    );
}

export function runFileSha256(runFile: EvalRunFile): string {
    return sha256Hex(canonicalRunFileJson(runFile));
}

export function verifyRunFile(runFile: EvalRunFile): {
    ok: boolean;
    expected: string | null;
    actual: string;
} {
    const actual = runFileSha256(runFile);
    const expected = runFile.selfSha256 ?? null;
    return { ok: actual === expected, expected, actual };
}

/** Return a copy with selfSha256 stamped from the canonical content. */
export function finalizeRunFile(runFile: EvalRunFile): EvalRunFile {
    return { ...runFile, selfSha256: runFileSha256(runFile) };
}

export function computeRunTotals(records: EvalRunRecord[]): EvalRunTotals {
    const totals: EvalRunTotals = {
        questionCount: records.length,
        errorCount: 0,
        totalMs: 0,
        totalCostUsd: 0,
        tokens: { input: 0, output: 0, thought: 0 },
    };
    for (const record of records) {
        if (record.error) totals.errorCount += 1;
        totals.totalMs += record.timings.totalMs;
        totals.totalCostUsd += record.costUsd ?? 0;
        totals.tokens.input += record.tokens.input ?? 0;
        totals.tokens.output += record.tokens.output ?? 0;
        totals.tokens.thought += record.tokens.thought ?? 0;
    }
    return totals;
}

// ─── Freeze receipt ─────────────────────────────────────────────

export interface FreezeCandidateReceipt {
    runId: string;
    datasetId: string;
    recordCount: number;
    answersSha256: string;
}

/**
 * Hash of the answer set alone (question id, turn, and the captured
 * answer), sorted by (questionId, turn) so the receipt is independent of
 * runner execution order. Committing this receipt BEFORE evidence is
 * consulted is what makes holdout scoring auditable: the scorer refuses
 * to run unless the exact answer set was frozen first.
 */
export function freezeCandidateOutputs(
    runFile: EvalRunFile,
): FreezeCandidateReceipt {
    const answers = runFile.records
        .map((record) => ({
            questionId: record.questionId,
            turn: record.turn,
            answer: record.answer,
        }))
        .sort((left, right) =>
            left.questionId !== right.questionId
                ? left.questionId < right.questionId
                    ? -1
                    : 1
                : left.turn - right.turn,
        );
    return {
        runId: runFile.runId,
        datasetId: runFile.datasetId,
        recordCount: runFile.records.length,
        answersSha256: sha256Hex(JSON.stringify(deepSortKeys(answers), null, 2)),
    };
}

// ─── Acceptance bands ───────────────────────────────────────────

export interface AcceptanceBand {
    min?: number;
    max?: number;
}

export interface AcceptanceBandsFile {
    schemaVersion: 1;
    basedOnRunId: string;
    datasetId: string;
    bands: Record<string, AcceptanceBand>;
    selfSha256: string | null;
}

export const BANDS_HASH_RECIPE =
    "sha256 hex digest of JSON.stringify(canonical, null, 2) where canonical is the bands file " +
    "with fields in the fixed order {schemaVersion, basedOnRunId, datasetId, bands, selfSha256}, " +
    "selfSha256 replaced by null, and every nested object's keys sorted lexicographically";

export function canonicalBandsJson(bands: AcceptanceBandsFile): string {
    return JSON.stringify(
        {
            schemaVersion: bands.schemaVersion,
            basedOnRunId: bands.basedOnRunId,
            datasetId: bands.datasetId,
            bands: deepSortKeys(bands.bands),
            selfSha256: null,
        },
        null,
        2,
    );
}

export function acceptanceBandsSha256(bands: AcceptanceBandsFile): string {
    return sha256Hex(canonicalBandsJson(bands));
}

export function verifyAcceptanceBands(bands: AcceptanceBandsFile): {
    ok: boolean;
    expected: string | null;
    actual: string;
} {
    const actual = acceptanceBandsSha256(bands);
    const expected = bands.selfSha256 ?? null;
    return { ok: actual === expected, expected, actual };
}
