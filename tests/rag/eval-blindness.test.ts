/** @vitest-environment node */
/**
 * Mechanization proof for the holdout blindness discipline.
 *
 * Everything here runs on SYNTHETIC fixtures: no holdout evidence, spans,
 * or answers are read. The tests prove that
 *   - scoring a holdout run file is refused unless dev-locked acceptance
 *     bands exist AND a frozen candidate receipt matches the run file's
 *     answer set (both in-process and via the file-based gate);
 *   - the runner source is lexically free of every evidence field name.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
    assertHoldoutScoringAllowed,
} from "../../scripts/rag/verify-evaluation-freeze";
import {
    scoreRun,
    lockAcceptanceBands,
    type EvidenceCatalog,
} from "../../scripts/rag/score-eval";
import {
    loadBlindQuestions,
    orderQuestions,
} from "../../scripts/rag/run-eval";
import {
    acceptanceBandsSha256,
    computeRunTotals,
    finalizeRunFile,
    freezeCandidateOutputs,
    type AcceptanceBandsFile,
    type EvalRunFile,
    type EvalRunRecord,
    type FreezeCandidateReceipt,
} from "../../scripts/rag/lib/eval-records";

const DEV_DATASET_ID = "rag-development-v1";

function makeRecord(questionId: string, citations: string[]): EvalRunRecord {
    return {
        runId: "synthetic-run",
        datasetId: DEV_DATASET_ID,
        split: "development",
        questionId,
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
            fusion: { status: "ok", ms: 100 },
            rerank: { status: "ok", ms: null, rankedSourceIds: citations },
            coverage: { status: "skipped", ms: null },
        },
        answer: {
            text: `synthetic answer for ${questionId}`,
            citations,
            images: [],
            confidence: "medium",
            followUps: [],
        },
        timings: {
            perStageMs: { retrieval: 100, generation: 200 },
            totalMs: 1000,
        },
        tokens: { input: null, output: null, thought: null },
        retries: 0,
        fallbackPath: null,
        costUsd: 0.01,
        error: null,
    };
}

function makeRunFile(overrides: {
    runId: string;
    datasetId: string;
    split: string;
}): EvalRunFile {
    const records = [
        { ...makeRecord("s-q1", ["S1"]), ...overrides },
        { ...makeRecord("s-q2", ["S2"]), ...overrides },
    ];
    return finalizeRunFile({
        schemaVersion: 1,
        runId: overrides.runId,
        datasetId: overrides.datasetId,
        split: overrides.split,
        config: records[0].config,
        startedAt: null,
        records,
        totals: computeRunTotals(records),
        selfSha256: null,
    });
}

const devEvidence: EvidenceCatalog = {
    datasetId: DEV_DATASET_ID,
    split: "development",
    questions: [
        { id: "s-q1", expectedSourceIdsAny: ["S1"] },
        { id: "s-q2", expectedSourceIdsAny: ["S2"] },
    ],
};

// Synthetic holdout evidence: invented ids only, never the real holdout.
const holdoutEvidence: EvidenceCatalog = {
    datasetId: "synthetic-holdout-v0",
    split: "holdout",
    questions: devEvidence.questions,
};

describe("holdout scoring gate", () => {
    let dir: string;
    let bandsPath: string;
    let receiptPath: string;
    let bands: AcceptanceBandsFile;
    let holdoutRun: EvalRunFile;
    let receipt: FreezeCandidateReceipt;

    beforeAll(() => {
        dir = mkdtempSync(path.join(tmpdir(), "eval-blindness-"));
        const devRun = makeRunFile({
            runId: "synthetic-dev-baseline",
            datasetId: DEV_DATASET_ID,
            split: "development",
        });
        bands = lockAcceptanceBands({
            baselineScores: scoreRun({ runFile: devRun, evidence: devEvidence }),
            margins: { recallAt8: 0.05, latencyTotalP95Ms: 500 },
        });
        bandsPath = path.join(dir, "acceptance-bands.json");
        writeFileSync(bandsPath, JSON.stringify(bands, null, 2));

        holdoutRun = makeRunFile({
            runId: "synthetic-holdout-run",
            datasetId: "synthetic-holdout-v0",
            split: "holdout",
        });
        receipt = freezeCandidateOutputs(holdoutRun);
        receiptPath = path.join(dir, "candidate.receipt.json");
        writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
    });

    afterAll(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    describe("assertHoldoutScoringAllowed unit matrix", () => {
        it("refuses when the bands file is missing", () => {
            expect(() =>
                assertHoldoutScoringAllowed({
                    bandsPath: path.join(dir, "missing-bands.json"),
                    candidateReceiptPath: receiptPath,
                    runFileSha: receipt.answersSha256,
                }),
            ).toThrow(/does not exist/);
        });

        it("refuses tampered bands (self-hash mismatch)", () => {
            const tamperedPath = path.join(dir, "tampered-bands.json");
            writeFileSync(
                tamperedPath,
                JSON.stringify(
                    {
                        ...bands,
                        bands: { ...bands.bands, recallAt8: { min: 0 } },
                    },
                    null,
                    2,
                ),
            );
            expect(() =>
                assertHoldoutScoringAllowed({
                    bandsPath: tamperedPath,
                    candidateReceiptPath: receiptPath,
                    runFileSha: receipt.answersSha256,
                }),
            ).toThrow(/self-hash/);
        });

        it("refuses bands locked on a non-development dataset", () => {
            const wrongDataset: AcceptanceBandsFile = {
                schemaVersion: 1,
                basedOnRunId: "synthetic-dev-baseline",
                datasetId: "not-the-dev-set",
                bands: bands.bands,
                selfSha256: null,
            };
            wrongDataset.selfSha256 = acceptanceBandsSha256(wrongDataset);
            const wrongPath = path.join(dir, "wrong-dataset-bands.json");
            writeFileSync(wrongPath, JSON.stringify(wrongDataset, null, 2));
            expect(() =>
                assertHoldoutScoringAllowed({
                    bandsPath: wrongPath,
                    candidateReceiptPath: receiptPath,
                    runFileSha: receipt.answersSha256,
                }),
            ).toThrow(/development dataset/);
        });

        it("refuses when the candidate receipt is missing", () => {
            expect(() =>
                assertHoldoutScoringAllowed({
                    bandsPath,
                    candidateReceiptPath: path.join(dir, "missing.receipt.json"),
                    runFileSha: receipt.answersSha256,
                }),
            ).toThrow(/receipt.*does not exist/);
        });

        it("refuses when the receipt sha does not match the run file", () => {
            expect(() =>
                assertHoldoutScoringAllowed({
                    bandsPath,
                    candidateReceiptPath: receiptPath,
                    runFileSha: "0".repeat(64),
                }),
            ).toThrow(/does not match/);
        });

        it("allows when bands and a matching receipt are both present", () => {
            const result = assertHoldoutScoringAllowed({
                bandsPath,
                candidateReceiptPath: receiptPath,
                runFileSha: receipt.answersSha256,
            });
            expect(result.answersSha256).toBe(receipt.answersSha256);
            expect(result.bandsBasedOnRunId).toBe("synthetic-dev-baseline");
        });

        it("pre-run form (runFileSha null) checks bands and receipt existence", () => {
            expect(() =>
                assertHoldoutScoringAllowed({
                    bandsPath,
                    candidateReceiptPath: receiptPath,
                    runFileSha: null,
                }),
            ).not.toThrow();
        });
    });

    describe("scoreRun in-process guard", () => {
        it("refuses a holdout run file without bands", () => {
            expect(() =>
                scoreRun({ runFile: holdoutRun, evidence: holdoutEvidence }),
            ).toThrow(/locked acceptance bands/);
        });

        it("refuses a holdout run file without a candidate receipt", () => {
            expect(() =>
                scoreRun({
                    runFile: holdoutRun,
                    evidence: holdoutEvidence,
                    bands,
                }),
            ).toThrow(/frozen candidate receipt/);
        });

        it("refuses when the receipt sha mismatches the answers", () => {
            expect(() =>
                scoreRun({
                    runFile: holdoutRun,
                    evidence: holdoutEvidence,
                    bands,
                    candidateReceipt: { ...receipt, answersSha256: "0".repeat(64) },
                }),
            ).toThrow(/does not match/);
        });

        it("scores when both dev-locked bands and a matching receipt are present", () => {
            const report = scoreRun({
                runFile: holdoutRun,
                evidence: holdoutEvidence,
                bands,
                candidateReceipt: receipt,
            });
            expect(report.split).toBe("holdout");
            expect(report.metrics.recallAt8).toBe(1);
        });

        it("never gates development run files", () => {
            const devRun = makeRunFile({
                runId: "synthetic-dev-baseline",
                datasetId: DEV_DATASET_ID,
                split: "development",
            });
            expect(() =>
                scoreRun({ runFile: devRun, evidence: devEvidence }),
            ).not.toThrow();
        });
    });
});

describe("runner blindness", () => {
    // Field names that carry evidence or expected answers in the holdout
    // catalog and the development catalog. The runner must never name them.
    const FORBIDDEN_FIELD_PATTERN =
        /\bacceptableEvidenceGroups\b|\brequiredClaims\b|\brequiredBehavior\b|\bresolvedQuestion\b|\bnoAnswerChecks\b|\bspans\b|\bexpectedSourceIds|\bexpectedFactsAny\b|\bkeywordsAny\b|\bforbiddenInAnswer\b|\bexpectedRefusal\b|\bexpectedImagesAny\b/;

    it("static guard (lexical only — cannot catch dynamic key access): run-eval.ts source names no holdout/dev evidence field", () => {
        const source = readFileSync(
            path.resolve(__dirname, "../../scripts/rag/run-eval.ts"),
            "utf8",
        );
        expect(source).not.toMatch(FORBIDDEN_FIELD_PATTERN);
    });

    it("loadBlindQuestions strips every field except blind-safe identity fields", () => {
        const dir = mkdtempSync(path.join(tmpdir(), "eval-blind-catalog-"));
        try {
            const catalogPath = path.join(dir, "catalog.json");
            writeFileSync(
                catalogPath,
                JSON.stringify({
                    datasetId: "synthetic-catalog",
                    split: "holdout",
                    questions: [
                        {
                            id: "c-q1",
                            question: "first?",
                            secretEvidenceField: "MUST NOT SURFACE",
                        },
                        {
                            id: "c-q2",
                            question: "second?",
                            turn: 2,
                            dependsOn: "c-q1",
                            conversationId: "c-conv",
                            anotherAnswerField: ["MUST NOT SURFACE"],
                        },
                    ],
                }),
            );
            const loaded = loadBlindQuestions(catalogPath);
            expect(loaded.datasetId).toBe("synthetic-catalog");
            expect(loaded.questions).toHaveLength(2);
            for (const question of loaded.questions) {
                expect(
                    Object.keys(question).every((key) =>
                        ["id", "question", "turn", "dependsOn", "conversationId", "filters"].includes(key),
                    ),
                ).toBe(true);
            }
            expect(JSON.stringify(loaded)).not.toContain("MUST NOT SURFACE");
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it("orderQuestions runs dependsOn targets first and rejects cycles", () => {
        const ordered = orderQuestions([
            { id: "b", question: "follow-up", dependsOn: "a", turn: 2 },
            { id: "a", question: "opener" },
            { id: "c", question: "independent" },
        ]);
        expect(ordered.map((q) => q.id)).toEqual(["a", "b", "c"]);
        expect(() =>
            orderQuestions([
                { id: "x", question: "?", dependsOn: "y" },
                { id: "y", question: "?", dependsOn: "x" },
            ]),
        ).toThrow(/Unresolvable/);
    });
});
