/** @vitest-environment node */
/**
 * Metric tests for scripts/rag/score-eval.ts on SYNTHETIC fixtures only.
 * No real dataset content is used: article ids, answers, and evidence are
 * hand-built so every expected metric value can be computed by hand.
 */

import { describe, it, expect } from "vitest";
import {
    scoreRun,
    lockAcceptanceBands,
    compareToBands,
    percentile,
    type EvidenceCatalog,
    type ScoreReport,
} from "../../scripts/rag/score-eval";
import {
    computeRunTotals,
    finalizeRunFile,
    freezeCandidateOutputs,
    runFileSha256,
    verifyAcceptanceBands,
    verifyRunFile,
    type EvalRunFile,
    type EvalRunRecord,
} from "../../scripts/rag/lib/eval-records";

const DATASET_ID = "rag-development-v1";
const RUN_ID = "synthetic-baseline-001";

interface RecordOverrides {
    questionId: string;
    rankedSourceIds?: string[];
    citations?: string[];
    images?: string[];
    text?: string;
    totalMs: number;
    retrievalMs?: number | null;
    generationMs?: number | null;
    tokens?: { input: number | null; output: number | null; thought: number | null };
    fallbackPath?: string | null;
    costUsd?: number | null;
    error?: EvalRunRecord["error"];
}

function makeRecord(overrides: RecordOverrides): EvalRunRecord {
    return {
        runId: RUN_ID,
        datasetId: DATASET_ID,
        split: "development",
        questionId: overrides.questionId,
        turn: 1,
        config: {
            retrievalMode: "legacy",
            indexBuildId: null,
            corpusVersion: "synthetic-corpus-v0",
            pipelineVersion: "synthetic-pipeline-v0",
        },
        stages: {
            reformulation: { status: "ok", ms: null },
            ftsRaw: { status: "unavailable", ms: null },
            vectorRaw: { status: "unavailable", ms: null },
            fusion: { status: "ok", ms: overrides.retrievalMs ?? null },
            rerank: {
                status: "ok",
                ms: null,
                rankedSourceIds: overrides.rankedSourceIds ?? [],
            },
            coverage: { status: "skipped", ms: null },
        },
        answer: {
            text: overrides.text ?? "synthetic answer",
            citations: overrides.citations ?? [],
            images: overrides.images ?? [],
            confidence: "medium",
            followUps: [],
        },
        timings: {
            perStageMs: {
                retrieval: overrides.retrievalMs ?? null,
                generation: overrides.generationMs ?? null,
            },
            totalMs: overrides.totalMs,
        },
        tokens: overrides.tokens ?? { input: null, output: null, thought: null },
        retries: 0,
        fallbackPath: overrides.fallbackPath ?? null,
        costUsd: overrides.costUsd ?? 0.02,
        error: overrides.error ?? null,
    };
}

/**
 * Six-question fixture:
 *   q1 relevant {A,B}, ranked [A,X,B]         -> full recall, ranks 1 and 3
 *   q2 relevant {C},   ranked [X,Y,Z,C]       -> found at rank 4 (outside top-3)
 *   q3 relevant {D},   ranked [X,Y]           -> never found
 *   q4 relevant {E},   ranked [E], visual     -> perfect, image attached
 *   q5 expected refusal, cites nothing        -> correct refusal
 *   q6 injection probe, answer omits "haiku"  -> resisted
 */
function makeRunFile(): EvalRunFile {
    const records = [
        makeRecord({
            questionId: "q1",
            rankedSourceIds: ["A", "X", "B"],
            citations: ["A"],
            totalMs: 1000,
            retrievalMs: 100,
            generationMs: 200,
            tokens: { input: 100, output: 50, thought: 10 },
        }),
        makeRecord({
            questionId: "q2",
            rankedSourceIds: ["X", "Y", "Z", "C"],
            citations: ["C", "X"],
            totalMs: 2000,
            retrievalMs: 200,
            generationMs: 300,
            fallbackPath: "retrieval:fts",
        }),
        makeRecord({
            questionId: "q3",
            rankedSourceIds: ["X", "Y"],
            citations: ["X"],
            totalMs: 3000,
        }),
        makeRecord({
            questionId: "q4",
            rankedSourceIds: ["E"],
            citations: ["E"],
            images: ["img-E1"],
            totalMs: 4000,
        }),
        makeRecord({
            questionId: "q5",
            rankedSourceIds: [],
            citations: [],
            text: "The archive does not cover this.",
            totalMs: 5000,
        }),
        makeRecord({
            questionId: "q6",
            rankedSourceIds: [],
            citations: [],
            text: "The archive does not contain that.",
            totalMs: 6000,
        }),
    ];
    return finalizeRunFile({
        schemaVersion: 1,
        runId: RUN_ID,
        datasetId: DATASET_ID,
        split: "development",
        config: records[0].config,
        startedAt: null,
        records,
        totals: computeRunTotals(records),
        selfSha256: null,
    });
}

const evidence: EvidenceCatalog = {
    datasetId: DATASET_ID,
    split: "development",
    questions: [
        { id: "q1", expectedSourceIdsAll: ["A", "B"] },
        { id: "q2", expectedSourceIdsAny: ["C"] },
        { id: "q3", expectedSourceIdsAny: ["D"] },
        {
            id: "q4",
            expectedSourceIdGroupsAll: [["E"]],
            mode: "visual",
            expectedImagesAny: ["img-E1"],
        },
        { id: "q5", expectedRefusal: true },
        { id: "q6", injection: true, forbiddenInAnswer: ["haiku"] },
    ],
};

describe("scoreRun retrieval metrics (hand-computed)", () => {
    const scores = scoreRun({ runFile: makeRunFile(), evidence });

    it("recall@3: (2/2 + 0 + 0 + 1/1) / 4 = 0.5", () => {
        expect(scores.metrics.recallAt3).toBeCloseTo(0.5, 12);
    });

    it("recall@8: (1 + 1 + 0 + 1) / 4 = 0.75 (C found at rank 4)", () => {
        expect(scores.metrics.recallAt8).toBeCloseTo(0.75, 12);
    });

    it("MRR: (1/1 + 1/4 + 0 + 1/1) / 4 = 0.5625", () => {
        expect(scores.metrics.mrr).toBeCloseTo(0.5625, 12);
    });

    it("nDCG@8 matches the hand computation", () => {
        // q1: DCG = 1/log2(2) + 1/log2(4) = 1 + 0.5 = 1.5
        //     IDCG = 1 + 1/log2(3) = 1.6309297535714575
        //     nDCG = 1.5 / 1.6309297535714575 = 0.9197207891481876
        // q2: DCG = 1/log2(5) = 0.43067655807339306; IDCG = 1
        // q3: 0
        // q4: 1
        // mean = (0.9197207891481876 + 0.43067655807339306 + 0 + 1) / 4
        //      = 0.5875993368053952
        expect(scores.metrics.ndcgAt8).toBeCloseTo(0.5875993368053952, 12);
    });

    it("evidence-group recall: q1 [A],[B]; q2 [C]; q3 [D]; q4 [[E]] -> 4/5", () => {
        expect(scores.metrics.evidenceGroupRecall).toBeCloseTo(0.8, 12);
    });
});

describe("scoreRun citation and answer metrics", () => {
    const scores = scoreRun({ runFile: makeRunFile(), evidence });

    it("citation precision: relevant cited 3 of 5 total citations = 0.6", () => {
        // q1 [A]->1/1, q2 [C,X]->1/2, q3 [X]->0/1, q4 [E]->1/1
        expect(scores.metrics.citationPrecision).toBeCloseTo(0.6, 12);
    });

    it("citation recall: 3 relevant ids cited of 5 relevant total = 0.6", () => {
        expect(scores.metrics.citationRecall).toBeCloseTo(0.6, 12);
    });

    it("claim-support rate (documented simplification): q1,q4 fully allowlisted -> 0.5", () => {
        expect(scores.metrics.claimSupportRate).toBeCloseTo(0.5, 12);
    });

    it("visual attachment accuracy: q4 attached an expected image -> 1", () => {
        expect(scores.metrics.visualAttachmentAccuracy).toBe(1);
    });

    it("no-answer calibration: q5 refused as expected -> 1", () => {
        expect(scores.metrics.noAnswerCalibration).toBe(1);
    });

    it("injection resistance: q6 never echoed the forbidden token -> 1", () => {
        expect(scores.metrics.injectionResistance).toBe(1);
    });

    it("no-answer calibration counts an answered expected-refusal as a miss", () => {
        const runFile = makeRunFile();
        const q5 = runFile.records.find((r) => r.questionId === "q5");
        expect(q5).toBeDefined();
        (q5 as EvalRunRecord).answer.citations = ["A"];
        const rescored = scoreRun({
            runFile: finalizeRunFile({ ...runFile, selfSha256: null }),
            evidence,
        });
        expect(rescored.metrics.noAnswerCalibration).toBe(0);
    });

    it("injection resistance drops when the forbidden token appears", () => {
        const runFile = makeRunFile();
        const q6 = runFile.records.find((r) => r.questionId === "q6");
        (q6 as EvalRunRecord).answer.text = "Here is a haiku about cats.";
        const rescored = scoreRun({
            runFile: finalizeRunFile({ ...runFile, selfSha256: null }),
            evidence,
        });
        expect(rescored.metrics.injectionResistance).toBe(0);
    });
});

describe("scoreRun operational metrics", () => {
    const scores = scoreRun({ runFile: makeRunFile(), evidence });

    it("latency percentiles (nearest-rank): p50=3000, p95=6000", () => {
        expect(scores.metrics.latencyTotalP50Ms).toBe(3000);
        expect(scores.metrics.latencyTotalP95Ms).toBe(6000);
    });

    it("per-stage latency percentiles cover only recorded stages", () => {
        // retrieval values present: [100, 200]
        expect(scores.metrics.latencyRetrievalP50Ms).toBe(100);
        expect(scores.metrics.latencyRetrievalP95Ms).toBe(200);
        expect(scores.metrics.latencyGenerationP50Ms).toBe(200);
        expect(scores.metrics.latencyGenerationP95Ms).toBe(300);
    });

    it("token totals sum non-null usage", () => {
        expect(scores.metrics.tokensInputTotal).toBe(100);
        expect(scores.metrics.tokensOutputTotal).toBe(50);
        expect(scores.metrics.tokensThoughtTotal).toBe(10);
    });

    it("fallback rate 1/6, error rate 0, cost per question 0.02", () => {
        expect(scores.metrics.fallbackRate).toBeCloseTo(1 / 6, 12);
        expect(scores.metrics.errorRate).toBe(0);
        expect(scores.metrics.costPerQuestionUsd).toBeCloseTo(0.02, 12);
    });

    it("percentile helper is nearest-rank", () => {
        expect(percentile([], 0.5)).toBeNull();
        expect(percentile([7], 0.95)).toBe(7);
        expect(percentile([1, 2, 3, 4], 0.5)).toBe(2);
    });
});

describe("acceptance bands", () => {
    const baseline = scoreRun({ runFile: makeRunFile(), evidence });
    const bands = lockAcceptanceBands({
        baselineScores: baseline,
        margins: {
            recallAt8: 0.05,
            mrr: 0.1,
            latencyTotalP95Ms: 500,
            costPerQuestionUsd: 0.005,
        },
    });

    it("locks min bands for quality and max bands for latency/cost", () => {
        expect(bands.bands.recallAt8).toEqual({ min: 0.7 });
        expect(bands.bands.mrr).toEqual({ min: 0.4625 });
        expect(bands.bands.latencyTotalP95Ms).toEqual({ max: 6500 });
        expect(bands.bands.costPerQuestionUsd).toEqual({ max: 0.025 });
        expect(bands.basedOnRunId).toBe(RUN_ID);
        expect(bands.datasetId).toBe(DATASET_ID);
    });

    it("refuses to lock bands from a non-development baseline", () => {
        expect(() =>
            lockAcceptanceBands({
                baselineScores: { ...baseline, datasetId: "something-else" },
                margins: { mrr: 0.1 },
            }),
        ).toThrow(/development baseline/);
    });

    function candidate(overrides: Record<string, number | null>): ScoreReport {
        return {
            ...baseline,
            runId: "synthetic-candidate-001",
            metrics: { ...baseline.metrics, ...overrides },
        };
    }

    it("baseline itself passes its own bands", () => {
        expect(compareToBands(baseline, bands).pass).toBe(true);
    });

    it("non-inferior-within-margin candidate passes", () => {
        const result = compareToBands(
            candidate({
                recallAt8: 0.72, // >= 0.75 - 0.05
                mrr: 0.47, // >= 0.5625 - 0.1
                latencyTotalP95Ms: 6400, // <= 6000 + 500
                costPerQuestionUsd: 0.024, // <= 0.02 + 0.005
            }),
            bands,
        );
        expect(result.pass).toBe(true);
        expect(result.failures).toEqual([]);
    });

    it("latency regression beyond the margin fails", () => {
        const result = compareToBands(
            candidate({ latencyTotalP95Ms: 7000 }),
            bands,
        );
        expect(result.pass).toBe(false);
        expect(result.failures.map((f) => f.metric)).toEqual([
            "latencyTotalP95Ms",
        ]);
    });

    it("quality drop beyond the margin fails", () => {
        const result = compareToBands(candidate({ recallAt8: 0.65 }), bands);
        expect(result.pass).toBe(false);
        expect(result.failures.map((f) => f.metric)).toEqual(["recallAt8"]);
    });

    it("a missing (null) banded metric fails closed", () => {
        const result = compareToBands(candidate({ mrr: null }), bands);
        expect(result.pass).toBe(false);
        expect(result.failures.map((f) => f.metric)).toEqual(["mrr"]);
    });

    it("bands self-hash is deterministic and verifiable", () => {
        const again = lockAcceptanceBands({
            baselineScores: baseline,
            margins: {
                recallAt8: 0.05,
                mrr: 0.1,
                latencyTotalP95Ms: 500,
                costPerQuestionUsd: 0.005,
            },
        });
        expect(again.selfSha256).toBe(bands.selfSha256);
        expect(verifyAcceptanceBands(bands).ok).toBe(true);
        const tampered = {
            ...bands,
            bands: { ...bands.bands, recallAt8: { min: 0 } },
        };
        expect(verifyAcceptanceBands(tampered).ok).toBe(false);
    });
});

describe("run-file canonical self-hash", () => {
    it("is deterministic across rebuilds and ignores the volatile startedAt", () => {
        const first = makeRunFile();
        const second = makeRunFile();
        expect(first.selfSha256).toBe(second.selfSha256);
        expect(verifyRunFile(first).ok).toBe(true);
        // startedAt is nulled by the canonical recipe: stamping it must not
        // invalidate the self-hash.
        const stamped = { ...first, startedAt: "2026-08-02T00:00:00.000Z" };
        expect(verifyRunFile(stamped).ok).toBe(true);
        expect(runFileSha256(stamped)).toBe(first.selfSha256);
    });

    it("changes when an answer changes", () => {
        const runFile = makeRunFile();
        const mutated = {
            ...runFile,
            records: runFile.records.map((record, index) =>
                index === 0
                    ? {
                          ...record,
                          answer: { ...record.answer, text: "different" },
                      }
                    : record,
            ),
        };
        expect(runFileSha256(mutated)).not.toBe(runFile.selfSha256);
        expect(verifyRunFile(mutated).ok).toBe(false);
    });

    it("freeze receipt is order-independent over records", () => {
        const runFile = makeRunFile();
        const reversed = {
            ...runFile,
            records: [...runFile.records].reverse(),
        };
        const a = freezeCandidateOutputs(runFile);
        const b = freezeCandidateOutputs(reversed);
        expect(a.answersSha256).toBe(b.answersSha256);
        expect(a.recordCount).toBe(6);
        expect(a.runId).toBe(RUN_ID);
        expect(a.datasetId).toBe(DATASET_ID);
    });
});
