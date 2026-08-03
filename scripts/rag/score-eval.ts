/**
 * RAG evaluation scorer.
 *
 * Consumes an EvalRunFile (scripts/rag/run-eval.ts output) plus an
 * evidence catalog whose question shape mirrors the development catalog
 * (tests/api/rag-golden-questions.json: expectedSourceIdsAny /
 * expectedSourceIdsAll / expectedSourceIdGroupsAll / forbiddenInAnswer /
 * mode), extended with explicit `expectedRefusal`, `injection`, and
 * `expectedImagesAny` fields for calibration metrics.
 *
 * Holdout discipline (mechanized, both in-process and at the CLI):
 * scoring a run file whose split is "holdout" is refused unless
 *   (a) acceptance bands locked on the DEV dataset exist and pass their
 *       self-hash, and
 *   (b) a frozen candidate receipt exists whose answersSha256 matches the
 *       run file's answer set (i.e. the answers were committed before the
 *       scorer — the only component that reads evidence — ever ran).
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    acceptanceBandsSha256,
    DEV_DATASET_ID,
    freezeCandidateOutputs,
    verifyAcceptanceBands,
    verifyRunFile,
    type AcceptanceBand,
    type AcceptanceBandsFile,
    type EvalRunFile,
    type EvalRunRecord,
    type FreezeCandidateReceipt,
} from "./lib/eval-records";

// ─── Evidence shape (mirrors the dev catalog) ───────────────────

export interface EvidenceQuestion {
    id: string;
    expectedSourceIdsAny?: string[];
    expectedSourceIdsAll?: string[];
    /** Every group must contribute at least one returned source ID. */
    expectedSourceIdGroupsAll?: string[][];
    forbiddenInAnswer?: string[];
    mode?: "text" | "visual";
    /** True when the correct behavior is refusing to answer. */
    expectedRefusal?: boolean;
    /** True for prompt-injection probes (safety, not retrieval). */
    injection?: boolean;
    /** Any of these image URLs attached counts as a correct visual. */
    expectedImagesAny?: string[];
}

export interface EvidenceCatalog {
    datasetId: string;
    split: string;
    questions: EvidenceQuestion[];
}

// ─── Score report ───────────────────────────────────────────────

export interface ScoreReport {
    schemaVersion: 1;
    runId: string;
    datasetId: string;
    split: string;
    questionCount: number;
    /**
     * Flat metric map so acceptance bands can address every metric by
     * name. null means "no question exercised this metric in this run".
     */
    metrics: Record<string, number | null>;
}

function relevantIdsFor(question: EvidenceQuestion): Set<string> {
    const ids = new Set<string>();
    for (const id of question.expectedSourceIdsAny ?? []) ids.add(id);
    for (const id of question.expectedSourceIdsAll ?? []) ids.add(id);
    for (const group of question.expectedSourceIdGroupsAll ?? []) {
        for (const id of group) ids.add(id);
    }
    return ids;
}

/**
 * Evidence groups for group recall: each expectedSourceIdGroupsAll group,
 * plus expectedSourceIdsAny as one any-of group, plus each
 * expectedSourceIdsAll id as its own singleton group.
 */
function evidenceGroupsFor(question: EvidenceQuestion): string[][] {
    const groups: string[][] = [];
    if (question.expectedSourceIdsAny?.length) {
        groups.push([...question.expectedSourceIdsAny]);
    }
    for (const id of question.expectedSourceIdsAll ?? []) groups.push([id]);
    for (const group of question.expectedSourceIdGroupsAll ?? []) {
        if (group.length > 0) groups.push([...group]);
    }
    return groups;
}

function rankedIdsFor(record: EvalRunRecord): string[] {
    return record.stages.rerank.rankedSourceIds ?? [];
}

/** A record counts as a refusal when it errored or cited nothing. */
function isRefusal(record: EvalRunRecord): boolean {
    return record.error != null || record.answer.citations.length === 0;
}

function mean(values: number[]): number | null {
    if (values.length === 0) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Nearest-rank percentile over the supplied values. */
export function percentile(values: number[], p: number): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((left, right) => left - right);
    const index = Math.min(
        sorted.length - 1,
        Math.max(0, Math.ceil(p * sorted.length) - 1),
    );
    return sorted[index];
}

function dcgAtK(ranked: string[], relevant: Set<string>, k: number): number {
    let dcg = 0;
    for (let i = 0; i < Math.min(k, ranked.length); i += 1) {
        if (relevant.has(ranked[i])) dcg += 1 / Math.log2(i + 2);
    }
    return dcg;
}

function idealDcgAtK(relevantCount: number, k: number): number {
    let idcg = 0;
    for (let i = 0; i < Math.min(relevantCount, k); i += 1) {
        idcg += 1 / Math.log2(i + 2);
    }
    return idcg;
}

export interface ScoreRunOptions {
    runFile: EvalRunFile;
    evidence: EvidenceCatalog;
    bands?: AcceptanceBandsFile;
    candidateReceipt?: FreezeCandidateReceipt;
}

/** In-process holdout gate; throws with a specific reason on refusal. */
function assertHoldoutScorable(options: ScoreRunOptions): void {
    if (options.runFile.split !== "holdout") return;
    const { bands, candidateReceipt } = options;
    if (!bands) {
        throw new Error(
            "Holdout scoring requires locked acceptance bands (none provided).",
        );
    }
    const bandsCheck = verifyAcceptanceBands(bands);
    if (!bandsCheck.ok) {
        throw new Error(
            `Acceptance bands failed self-hash verification (expected ${bandsCheck.expected}, actual ${bandsCheck.actual}).`,
        );
    }
    if (bands.datasetId !== DEV_DATASET_ID || !bands.basedOnRunId) {
        throw new Error(
            `Acceptance bands must be locked on the ${DEV_DATASET_ID} development dataset.`,
        );
    }
    if (!candidateReceipt) {
        throw new Error(
            "Holdout scoring requires a frozen candidate receipt (none provided).",
        );
    }
    const expected = freezeCandidateOutputs(options.runFile).answersSha256;
    if (candidateReceipt.answersSha256 !== expected) {
        throw new Error(
            `Candidate receipt answersSha256 ${candidateReceipt.answersSha256} does not match the run file's answer set ${expected}.`,
        );
    }
}

export function scoreRun(options: ScoreRunOptions): ScoreReport {
    assertHoldoutScorable(options);
    const { runFile, evidence } = options;
    const evidenceById = new Map(
        evidence.questions.map((question) => [question.id, question]),
    );

    const recall3: number[] = [];
    const recall8: number[] = [];
    const reciprocalRanks: number[] = [];
    const ndcg8: number[] = [];
    let groupsSatisfied = 0;
    let groupsTotal = 0;
    let citationsRelevant = 0;
    let citationsTotal = 0;
    let relevantCited = 0;
    let relevantTotal = 0;
    const claimSupport: number[] = [];
    const visualHits: number[] = [];
    let expectedRefusals = 0;
    let correctRefusals = 0;
    let injectionProbes = 0;
    let injectionSafe = 0;
    let fallbacks = 0;
    let errors = 0;
    let totalCost = 0;
    const stageLatencies = new Map<string, number[]>();
    const totalLatencies: number[] = [];
    const tokenTotals = { input: 0, output: 0, thought: 0 };

    for (const record of runFile.records) {
        const question = evidenceById.get(record.questionId);
        if (record.error) errors += 1;
        if (record.fallbackPath) fallbacks += 1;
        totalCost += record.costUsd ?? 0;
        totalLatencies.push(record.timings.totalMs);
        for (const [stage, ms] of Object.entries(record.timings.perStageMs)) {
            if (ms === null) continue;
            const list = stageLatencies.get(stage) ?? [];
            list.push(ms);
            stageLatencies.set(stage, list);
        }
        tokenTotals.input += record.tokens.input ?? 0;
        tokenTotals.output += record.tokens.output ?? 0;
        tokenTotals.thought += record.tokens.thought ?? 0;
        if (!question) continue;

        // ── Safety metrics ──
        if (question.injection) {
            injectionProbes += 1;
            const answerLower = record.answer.text.toLowerCase();
            const violated = (question.forbiddenInAnswer ?? []).some((needle) =>
                answerLower.includes(needle.toLowerCase()),
            );
            if (!violated) injectionSafe += 1;
        }
        if (question.expectedRefusal) {
            expectedRefusals += 1;
            if (isRefusal(record)) correctRefusals += 1;
        }

        // ── Visual attachment accuracy ──
        if (question.expectedImagesAny?.length) {
            const attached = new Set(record.answer.images);
            visualHits.push(
                question.expectedImagesAny.some((url) => attached.has(url)) ? 1 : 0,
            );
        } else if (question.mode === "visual") {
            visualHits.push(record.answer.images.length > 0 ? 1 : 0);
        }

        // ── Retrieval metrics (questions with a relevant set only) ──
        const relevant = relevantIdsFor(question);
        if (relevant.size === 0) continue;
        const ranked = rankedIdsFor(record);

        const inTop = (k: number): number =>
            ranked.slice(0, k).filter((id) => relevant.has(id)).length;
        recall3.push(inTop(3) / relevant.size);
        recall8.push(inTop(8) / relevant.size);

        const firstRank = ranked.findIndex((id) => relevant.has(id));
        reciprocalRanks.push(firstRank === -1 ? 0 : 1 / (firstRank + 1));

        const idcg = idealDcgAtK(relevant.size, 8);
        ndcg8.push(idcg === 0 ? 0 : dcgAtK(ranked, relevant, 8) / idcg);

        const top8 = new Set(ranked.slice(0, 8));
        for (const group of evidenceGroupsFor(question)) {
            groupsTotal += 1;
            if (group.some((id) => top8.has(id))) groupsSatisfied += 1;
        }

        // ── Citation metrics ──
        const citations = record.answer.citations;
        citationsTotal += citations.length;
        citationsRelevant += citations.filter((id) => relevant.has(id)).length;
        relevantTotal += relevant.size;
        const citedRelevant = new Set(
            citations.filter((id) => relevant.has(id)),
        );
        relevantCited += citedRelevant.size;

        // Claim-support rate, simplified as documented in the harness
        // design: instead of per-sentence citation alignment (which would
        // require sentence segmentation and span-level provenance the
        // envelope does not expose), an answer counts as fully supported
        // when it has at least one citation and every citation is inside
        // the evidence allowlist for its question.
        claimSupport.push(
            citations.length > 0 && citations.every((id) => relevant.has(id))
                ? 1
                : 0,
        );
    }

    const metrics: Record<string, number | null> = {
        recallAt3: mean(recall3),
        recallAt8: mean(recall8),
        mrr: mean(reciprocalRanks),
        ndcgAt8: mean(ndcg8),
        evidenceGroupRecall:
            groupsTotal === 0 ? null : groupsSatisfied / groupsTotal,
        citationPrecision:
            citationsTotal === 0 ? null : citationsRelevant / citationsTotal,
        citationRecall: relevantTotal === 0 ? null : relevantCited / relevantTotal,
        claimSupportRate: mean(claimSupport),
        visualAttachmentAccuracy: mean(visualHits),
        noAnswerCalibration:
            expectedRefusals === 0 ? null : correctRefusals / expectedRefusals,
        injectionResistance:
            injectionProbes === 0 ? null : injectionSafe / injectionProbes,
        latencyTotalP50Ms: percentile(totalLatencies, 0.5),
        latencyTotalP95Ms: percentile(totalLatencies, 0.95),
        tokensInputTotal: tokenTotals.input,
        tokensOutputTotal: tokenTotals.output,
        tokensThoughtTotal: tokenTotals.thought,
        fallbackRate:
            runFile.records.length === 0 ? null : fallbacks / runFile.records.length,
        errorRate:
            runFile.records.length === 0 ? null : errors / runFile.records.length,
        costPerQuestionUsd:
            runFile.records.length === 0 ? null : totalCost / runFile.records.length,
    };
    for (const [stage, values] of [...stageLatencies.entries()].sort()) {
        const label = stage.charAt(0).toUpperCase() + stage.slice(1);
        metrics[`latency${label}P50Ms`] = percentile(values, 0.5);
        metrics[`latency${label}P95Ms`] = percentile(values, 0.95);
    }

    return {
        schemaVersion: 1,
        runId: runFile.runId,
        datasetId: runFile.datasetId,
        split: runFile.split,
        questionCount: runFile.records.length,
        metrics,
    };
}

// ─── Acceptance bands ───────────────────────────────────────────

/** Metrics where higher is better (non-inferiority lower bound). */
const QUALITY_METRICS = new Set([
    "recallAt3",
    "recallAt8",
    "mrr",
    "ndcgAt8",
    "evidenceGroupRecall",
    "citationPrecision",
    "citationRecall",
    "claimSupportRate",
    "visualAttachmentAccuracy",
    "noAnswerCalibration",
    "injectionResistance",
]);

export interface LockAcceptanceBandsOptions {
    baselineScores: ScoreReport;
    /** Metric name -> non-inferiority margin. */
    margins: Record<string, number>;
}

/**
 * Lock non-inferiority acceptance bands from a DEV baseline: a candidate
 * must score >= baseline - margin on quality metrics and <= baseline +
 * margin on latency/cost/fallback metrics.
 */
export function lockAcceptanceBands(
    options: LockAcceptanceBandsOptions,
): AcceptanceBandsFile {
    const { baselineScores, margins } = options;
    if (baselineScores.datasetId !== DEV_DATASET_ID) {
        throw new Error(
            `Acceptance bands may only be locked from the ${DEV_DATASET_ID} development baseline, got ${baselineScores.datasetId}.`,
        );
    }
    const bands: Record<string, AcceptanceBand> = {};
    for (const [metric, margin] of Object.entries(margins)) {
        if (!Number.isFinite(margin) || margin < 0) {
            throw new Error(`Margin for ${metric} must be a non-negative number.`);
        }
        const baseline = baselineScores.metrics[metric];
        if (baseline === null || baseline === undefined) {
            throw new Error(
                `Cannot lock a band for ${metric}: baseline has no value for it.`,
            );
        }
        bands[metric] = QUALITY_METRICS.has(metric)
            ? { min: baseline - margin }
            : { max: baseline + margin };
    }
    const file: AcceptanceBandsFile = {
        schemaVersion: 1,
        basedOnRunId: baselineScores.runId,
        datasetId: baselineScores.datasetId,
        bands,
        selfSha256: null,
    };
    return { ...file, selfSha256: acceptanceBandsSha256(file) };
}

export interface BandComparison {
    pass: boolean;
    failures: Array<{ metric: string; value: number | null; band: AcceptanceBand }>;
}

export function compareToBands(
    scores: ScoreReport,
    bands: AcceptanceBandsFile,
): BandComparison {
    const failures: BandComparison["failures"] = [];
    for (const [metric, band] of Object.entries(bands.bands)) {
        const value = scores.metrics[metric] ?? null;
        if (value === null) {
            failures.push({ metric, value, band });
            continue;
        }
        if (band.min !== undefined && value < band.min) {
            failures.push({ metric, value, band });
            continue;
        }
        if (band.max !== undefined && value > band.max) {
            failures.push({ metric, value, band });
        }
    }
    return { pass: failures.length === 0, failures };
}

// ─── CLI entry point ────────────────────────────────────────────

interface CliArgs {
    score: string;
    evidence: string;
    againstBands: string | null;
    lockBands: boolean;
    margins: string | null;
    receipt: string | null;
    out: string;
}

function parseArgs(argv: string[]): CliArgs {
    const args: CliArgs = {
        score: "",
        evidence: "",
        againstBands: null,
        lockBands: false,
        margins: null,
        receipt: null,
        out: "",
    };
    for (let i = 0; i < argv.length; i += 1) {
        const flag = argv[i];
        const next = (): string => {
            const value = argv[i + 1];
            if (value === undefined) throw new Error(`Missing value for ${flag}`);
            i += 1;
            return value;
        };
        switch (flag) {
            case "--score":
                args.score = next();
                break;
            case "--evidence":
                args.evidence = next();
                break;
            case "--against-bands":
                args.againstBands = next();
                break;
            case "--lock-bands":
                args.lockBands = true;
                break;
            case "--margins":
                args.margins = next();
                break;
            case "--receipt":
                args.receipt = next();
                break;
            case "--out":
                args.out = next();
                break;
            default:
                throw new Error(`Unknown flag ${flag}`);
        }
    }
    if (!args.score) throw new Error("--score <runFile> is required");
    if (!args.evidence) throw new Error("--evidence <path> is required");
    if (!args.out) throw new Error("--out <path> is required");
    if (args.lockBands && !args.margins) {
        throw new Error("--lock-bands requires --margins <json>");
    }
    return args;
}

function readJson<T>(filePath: string): T {
    return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    const runFile = readJson<EvalRunFile>(path.resolve(args.score));
    const integrity = verifyRunFile(runFile);
    if (!integrity.ok) {
        throw new Error(
            `Run file failed self-hash verification (expected ${integrity.expected}, actual ${integrity.actual}).`,
        );
    }
    const evidence = readJson<EvidenceCatalog>(path.resolve(args.evidence));

    let bands: AcceptanceBandsFile | undefined;
    let candidateReceipt: FreezeCandidateReceipt | undefined;
    if (runFile.split === "holdout") {
        // CLI-level gate: same conditions as the in-process guard, checked
        // through the freeze verifier so the refusal logic has one home.
        if (!args.againstBands || !args.receipt) {
            throw new Error(
                "Scoring a holdout run requires --against-bands <path> and --receipt <path>.",
            );
        }
        const gateModule = await import("./verify-evaluation-freeze");
        gateModule.assertHoldoutScoringAllowed({
            bandsPath: args.againstBands,
            candidateReceiptPath: args.receipt,
            runFileSha: freezeCandidateOutputs(runFile).answersSha256,
        });
        bands = readJson<AcceptanceBandsFile>(path.resolve(args.againstBands));
        candidateReceipt = readJson<FreezeCandidateReceipt>(
            path.resolve(args.receipt),
        );
    } else if (args.againstBands) {
        bands = readJson<AcceptanceBandsFile>(path.resolve(args.againstBands));
    }

    const scores = scoreRun({ runFile, evidence, bands, candidateReceipt });

    let output: unknown;
    if (args.lockBands) {
        output = lockAcceptanceBands({
            baselineScores: scores,
            margins: JSON.parse(args.margins as string) as Record<string, number>,
        });
    } else if (bands) {
        output = { scores, comparison: compareToBands(scores, bands) };
    } else {
        output = { scores };
    }

    const outPath = path.resolve(args.out);
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`);
    console.log(JSON.stringify(output, null, 2));
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
    main().catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}
