/**
 * RAG evaluation runner.
 *
 * Drives the in-process /api/ask route handler (the same NextRequest
 * pattern as tests/api/rag-golden-questions.test.ts) over a question
 * catalog and captures one EvalRunRecord per question. The runner is
 * deliberately BLIND: it reads only question identity fields (id,
 * question text, turn ordering metadata) from any catalog and never
 * touches evidence, expected-answer, or frozen-span fields.
 *
 * Telemetry honesty: the non-streaming /api/ask envelope exposes
 * meta.{retrievalTimeMs, generationTimeMs, totalTimeMs, articlesSearched,
 * method, reformulatedQuery?, complexity?, coverage?, retrieval identity}
 * plus citations/sourceArticles/confidence/followUpQuestions. It does NOT
 * expose per-stage FTS/vector candidate lists, rerank latency, token
 * usage, or cost. Those gaps are recorded as status "unavailable" or null
 * fields — never invented.
 *
 * main() safety contract:
 *   - requires --yes, EVAL_DATABASE_URL, RAG_EVALUATION_MODE=1,
 *     RAG_EVALUATION_RUN_ID, RAG_CORPUS_VERSION, and a spend cap no
 *     greater than the approved $10 maximum (enforced by
 *     getRagEvaluationConfig);
 *   - evaluation mode keeps conversation turns process-local and never
 *     writes conversation/feedback rows (see src/lib/conversation-store);
 *   - --dataset holdout refuses to run unless the holdout-scoring gate of
 *     scripts/rag/verify-evaluation-freeze.ts passes (locked dev-based
 *     acceptance bands + a frozen candidate receipt).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neonConfig } from "@neondatabase/serverless";
import {
    computeRunTotals,
    finalizeRunFile,
    freezeCandidateOutputs,
    type EvalAnswerCapture,
    type EvalRunConfig,
    type EvalRunFile,
    type EvalRunRecord,
    type EvalRunStages,
    type EvalStageCapture,
} from "./lib/eval-records";

// ─── Injectable driver ──────────────────────────────────────────

export interface EvalAskInput {
    question: string;
    filters?: { category?: string; startDate?: string; endDate?: string };
    sessionId?: string;
}

export interface EvalDriver {
    ask(input: EvalAskInput): Promise<Response>;
}

export interface EvalQuestionInput {
    id: string;
    question: string;
    turn?: number;
    dependsOn?: string;
    conversationId?: string;
    filters?: EvalAskInput["filters"];
}

export interface RunEvalOptions {
    questions: EvalQuestionInput[];
    driver: EvalDriver;
    config: EvalRunConfig & {
        runId: string;
        datasetId: string;
        split: string;
        spendCapUsd: number;
        /**
         * Optional assumed per-question cost used for cap accounting when
         * the response envelope carries no cost field (its current state).
         * Defaults to 0 — i.e. cap enforcement then rests on reported cost.
         */
        assumedCostPerQuestionUsd?: number;
        maxAttemptsPerQuestion?: number;
        sleep?: (ms: number) => Promise<void>;
    };
    capture?: (record: EvalRunRecord) => void;
}

export interface RunEvalResult {
    records: EvalRunRecord[];
    totalCostUsd: number;
    aborted: boolean;
    abortReason: string | null;
}

const defaultSleep = (ms: number): Promise<void> =>
    new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

/**
 * Order questions so every dependsOn target runs before its dependent,
 * preserving input order otherwise. Throws on unknown or cyclic deps.
 */
export function orderQuestions(
    questions: EvalQuestionInput[],
): EvalQuestionInput[] {
    const remaining = [...questions];
    const done = new Set<string>();
    const ordered: EvalQuestionInput[] = [];
    while (remaining.length > 0) {
        const index = remaining.findIndex(
            (q) => !q.dependsOn || done.has(q.dependsOn),
        );
        if (index === -1) {
            throw new Error(
                `Unresolvable dependsOn ordering among: ${remaining.map((q) => q.id).join(", ")}`,
            );
        }
        const [next] = remaining.splice(index, 1);
        ordered.push(next);
        done.add(next.id);
    }
    return ordered;
}

interface AskResponseEnvelope {
    answer?: string;
    citations?: Array<{ articleId?: string }>;
    confidence?: "low" | "medium" | "high";
    mode?: string;
    sessionId?: string;
    sourceArticles?: Array<{ id?: string; imageUrls?: string[] }>;
    followUpQuestions?: string[];
    meta?: {
        retrievalTimeMs?: number;
        generationTimeMs?: number;
        totalTimeMs?: number;
        articlesSearched?: number;
        method?: string;
        reformulatedQuery?: string;
        complexity?: string;
        cacheHit?: boolean;
        indexBuildId?: string | null;
        retrievalTarget?: string;
        coverage?: Record<string, unknown>;
        costUsd?: number;
    };
    costUsd?: number;
    kind?: string;
    message?: string;
    error?: string;
}

function finiteOrNull(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function buildStages(body: AskResponseEnvelope): EvalRunStages {
    const meta = body.meta ?? {};
    const unavailable = (summary: string): EvalStageCapture => ({
        status: "unavailable",
        ms: null,
        summary,
    });
    const rankedSourceIds = (body.sourceArticles ?? [])
        .map((article) => article.id)
        .filter((id): id is string => typeof id === "string");
    return {
        reformulation: {
            status: "ok",
            ms: null,
            summary:
                "reformulated query observable only; stage latency not in envelope",
            detail: {
                reformulatedQuery: meta.reformulatedQuery ?? null,
                mode: body.mode ?? null,
                complexity: meta.complexity ?? null,
            },
        },
        ftsRaw: unavailable(
            "raw FTS candidate list is not exposed by the /api/ask envelope",
        ),
        vectorRaw: unavailable(
            "raw vector candidate list is not exposed by the /api/ask envelope",
        ),
        fusion: {
            status: "ok",
            ms: finiteOrNull(meta.retrievalTimeMs),
            summary: "fused retrieval observables (method + candidate count)",
            detail: {
                method: meta.method ?? null,
                articlesSearched: meta.articlesSearched ?? null,
                retrievalTarget: meta.retrievalTarget ?? null,
                indexBuildId: meta.indexBuildId ?? null,
            },
        },
        rerank: {
            status: "ok",
            ms: null,
            summary:
                "final post-rerank ranked order; rerank latency not in envelope",
            rankedSourceIds,
        },
        coverage: meta.coverage
            ? {
                  status: "ok",
                  ms: null,
                  detail: meta.coverage,
              }
            : {
                  status: "skipped",
                  ms: null,
                  summary: "no coverage intent for this question",
              },
    };
}

function buildAnswer(body: AskResponseEnvelope): EvalAnswerCapture {
    const citations = (body.citations ?? [])
        .map((citation) => citation.articleId)
        .filter((id): id is string => typeof id === "string");
    const citedSet = new Set(citations);
    const images = new Set<string>();
    for (const article of body.sourceArticles ?? []) {
        if (typeof article.id !== "string" || !citedSet.has(article.id)) continue;
        for (const url of article.imageUrls ?? []) {
            if (typeof url === "string" && url.length > 0) images.add(url);
        }
    }
    return {
        text: typeof body.answer === "string" ? body.answer : "",
        citations,
        images: [...images],
        confidence: body.confidence ?? null,
        followUps: (body.followUpQuestions ?? []).filter(
            (entry): entry is string => typeof entry === "string",
        ),
    };
}

export async function runEvalQuestions(
    options: RunEvalOptions,
): Promise<RunEvalResult> {
    const { driver, config, capture } = options;
    const ordered = orderQuestions(options.questions);
    const sleep = config.sleep ?? defaultSleep;
    const maxAttempts = config.maxAttemptsPerQuestion ?? 2;
    const assumedCost = config.assumedCostPerQuestionUsd ?? 0;
    const sessions = new Map<string, string>();
    const records: EvalRunRecord[] = [];
    let totalCostUsd = 0;
    let aborted = false;
    let abortReason: string | null = null;

    for (const question of ordered) {
        const sessionId = question.dependsOn
            ? sessions.get(question.dependsOn)
            : undefined;
        const started = Date.now();
        let retries = 0;
        let response: Response | null = null;
        let body: AskResponseEnvelope = {};
        let transportError: string | null = null;
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            transportError = null;
            try {
                response = await driver.ask({
                    question: question.question,
                    filters: question.filters,
                    sessionId,
                });
                body = (await response.json()) as AskResponseEnvelope;
            } catch (err) {
                response = null;
                body = {};
                transportError = err instanceof Error ? err.message : String(err);
            }
            const rateLimited = response?.status === 429;
            if (!rateLimited && transportError === null) break;
            if (attempt < maxAttempts) {
                retries += 1;
                const retryAfterSec = Number(
                    response?.headers.get("Retry-After") ?? "60",
                );
                await sleep(
                    Math.min(Number.isFinite(retryAfterSec) ? retryAfterSec : 60, 65) *
                        1000,
                );
            }
        }
        const totalMs = Date.now() - started;
        const status = response?.status ?? 0;
        const ok = status === 200 && transportError === null;
        if (typeof body.sessionId === "string") {
            sessions.set(question.id, body.sessionId);
        }

        const meta = body.meta ?? {};
        const costUsd = finiteOrNull(meta.costUsd ?? body.costUsd);
        const method = typeof meta.method === "string" ? meta.method : null;
        const record: EvalRunRecord = {
            runId: config.runId,
            datasetId: config.datasetId,
            split: config.split,
            questionId: question.id,
            turn: question.turn ?? 1,
            config: {
                retrievalMode: config.retrievalMode,
                indexBuildId: config.indexBuildId,
                corpusVersion: config.corpusVersion,
                pipelineVersion: config.pipelineVersion,
            },
            stages: buildStages(ok ? body : {}),
            answer: ok
                ? buildAnswer(body)
                : {
                      text: "",
                      citations: [],
                      images: [],
                      confidence: null,
                      followUps: [],
                  },
            timings: {
                perStageMs: {
                    retrieval: finiteOrNull(meta.retrievalTimeMs),
                    generation: finiteOrNull(meta.generationTimeMs),
                },
                totalMs: finiteOrNull(meta.totalTimeMs) ?? totalMs,
            },
            // Documented gap: the envelope exposes no token usage.
            tokens: { input: null, output: null, thought: null },
            retries,
            fallbackPath: meta.cacheHit
                ? "cache"
                : method !== null && method !== "hybrid"
                  ? `retrieval:${method}`
                  : null,
            costUsd,
            error: ok
                ? null
                : {
                      status,
                      kind: body.kind ?? null,
                      message:
                          transportError ??
                          body.message ??
                          body.error ??
                          `HTTP ${status}`,
                  },
        };
        records.push(record);
        capture?.(record);

        totalCostUsd += costUsd ?? assumedCost;
        if (totalCostUsd > config.spendCapUsd) {
            aborted = true;
            abortReason = `Accumulated cost $${totalCostUsd.toFixed(4)} exceeds the $${config.spendCapUsd} cap`;
            break;
        }
    }

    return { records, totalCostUsd, aborted, abortReason };
}

// ─── CLI entry point ────────────────────────────────────────────

interface CliArgs {
    dataset: "dev" | "holdout";
    mode: "legacy" | "versioned";
    build: string | null;
    out: string;
    yes: boolean;
    bands: string | null;
    receipt: string | null;
    limit: number | null;
}

function parseArgs(argv: string[]): CliArgs {
    const args: CliArgs = {
        dataset: "dev",
        mode: "legacy",
        build: null,
        out: "",
        yes: false,
        bands: null,
        receipt: null,
        limit: null,
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
            case "--dataset": {
                const value = next();
                if (value !== "dev" && value !== "holdout") {
                    throw new Error(`--dataset must be dev or holdout, got ${value}`);
                }
                args.dataset = value;
                break;
            }
            case "--mode": {
                const value = next();
                if (value !== "legacy" && value !== "versioned") {
                    throw new Error(`--mode must be legacy or versioned, got ${value}`);
                }
                args.mode = value;
                break;
            }
            case "--build":
                args.build = next();
                break;
            case "--out":
                args.out = next();
                break;
            case "--bands":
                args.bands = next();
                break;
            case "--receipt":
                args.receipt = next();
                break;
            case "--limit": {
                const value = Number(next());
                if (!Number.isInteger(value) || value < 1) {
                    throw new Error(`--limit must be a positive integer, got ${value}`);
                }
                args.limit = value;
                break;
            }
            case "--yes":
                args.yes = true;
                break;
            default:
                throw new Error(`Unknown flag ${flag}`);
        }
    }
    if (!args.out) throw new Error("--out <dir> is required");
    if (args.mode === "versioned" && !args.build) {
        throw new Error("--build <id> is required with --mode versioned");
    }
    return args;
}

/**
 * Load a question catalog reading ONLY blind-safe fields. This is the
 * mechanized blindness boundary: no evidence, expected-answer, or frozen
 * span fields are ever read, printed, or copied by the runner.
 */
export function loadBlindQuestions(filePath: string): {
    datasetId: string;
    split: string;
    questions: EvalQuestionInput[];
} {
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as {
        datasetId?: string;
        split?: string;
        questions?: Array<Record<string, unknown>>;
    };
    const questions: EvalQuestionInput[] = (raw.questions ?? []).map((entry) => {
        const id = entry.id;
        const question = entry.question;
        if (typeof id !== "string" || typeof question !== "string") {
            throw new Error("Catalog question is missing id or question text.");
        }
        return {
            id,
            question,
            turn: typeof entry.turn === "number" ? entry.turn : undefined,
            dependsOn:
                typeof entry.dependsOn === "string" ? entry.dependsOn : undefined,
            conversationId:
                typeof entry.conversationId === "string"
                    ? entry.conversationId
                    : undefined,
        };
    });
    return {
        datasetId: typeof raw.datasetId === "string" ? raw.datasetId : "unknown",
        split: typeof raw.split === "string" ? raw.split : "unknown",
        questions,
    };
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    if (!args.yes) {
        throw new Error(
            "Refusing to run a live evaluation without --yes (spends real API budget).",
        );
    }

    const evalDatabaseUrl = process.env.EVAL_DATABASE_URL?.trim();
    if (!evalDatabaseUrl) {
        throw new Error("EVAL_DATABASE_URL is required for evaluation runs.");
    }
    // The in-process route reads DATABASE_URL; evaluation runs point it at
    // the dedicated evaluation database. Guarded main()-only usage.
    process.env.DATABASE_URL = evalDatabaseUrl;
    // Local eval bridge: neonConfig must come from the SAME module instance
    // the app code resolves (static import → CJS build under tsx). A dynamic
    // import() here loads the driver's ESM copy, whose neonConfig the app's
    // clients never read — the setting would silently not apply.
    const shimUrl = process.env.NEON_HTTP_SHIM_URL?.trim();
    if (shimUrl) {
        neonConfig.fetchEndpoint = shimUrl;
    }
    process.env.RAG_RETRIEVAL_MODE = args.mode;
    if (args.build) process.env.RAG_ACTIVE_INDEX_BUILD_ID = args.build;

    // Assert the evaluation-mode env contract BEFORE any request: this
    // throws unless RAG_EVALUATION_MODE=1, RAG_EVALUATION_RUN_ID and
    // RAG_CORPUS_VERSION are set, and the spend cap is within the $10
    // maximum. Evaluation mode also guarantees conversation turns stay
    // process-local (never persisted) — see src/lib/conversation-store.
    const evaluationModule = await import("../../src/lib/rag-evaluation");
    const evaluation = evaluationModule.getRagEvaluationConfig();
    if (!evaluation.enabled) {
        throw new Error("RAG_EVALUATION_MODE=1 is required for evaluation runs.");
    }

    const datasetPath =
        args.dataset === "dev"
            ? path.resolve("tests/api/rag-golden-questions.json")
            : path.resolve("evaluation/rag/holdout/rag-holdout-v1.json");
    const catalog = loadBlindQuestions(datasetPath);
    // Smoke passes: --limit truncates by question COUNT in catalog order.
    // Only the blind-safe identity fields are ever touched, so the
    // blindness boundary is unchanged.
    if (args.limit !== null) {
        catalog.questions = catalog.questions.slice(0, args.limit);
    }

    if (args.dataset === "holdout") {
        if (!args.bands || !args.receipt) {
            throw new Error(
                "--dataset holdout requires --bands <path> and --receipt <path> so the holdout-scoring gate can be checked before any holdout question is asked.",
            );
        }
        const gateModule = await import("./verify-evaluation-freeze");
        gateModule.assertHoldoutScoringAllowed({
            bandsPath: args.bands,
            candidateReceiptPath: args.receipt,
            runFileSha: null,
        });
    }

    const indexModule = await import("../../src/lib/rag-index-config");
    const identity = indexModule.getRagRetrievalConfig();
    const config: EvalRunConfig = {
        retrievalMode: identity.mode,
        indexBuildId: identity.activeIndexBuildId,
        corpusVersion: identity.corpusVersion,
        pipelineVersion: identity.pipelineVersion,
    };

    // In-process route driver: identical NextRequest pattern to
    // tests/api/rag-golden-questions.test.ts.
    const routeModule = await import("../../src/app/api/ask/route");
    const serverModule = await import("next/server");
    const driver: EvalDriver = {
        async ask(input) {
            const request = new serverModule.NextRequest(
                "http://localhost:3000/api/ask",
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        question: input.question,
                        filters: input.filters,
                        sessionId: input.sessionId,
                    }),
                },
            );
            return routeModule.POST(request);
        },
    };

    const result = await runEvalQuestions({
        questions: catalog.questions,
        driver,
        config: {
            ...config,
            runId: evaluation.runId as string,
            datasetId: catalog.datasetId,
            split: catalog.split,
            spendCapUsd: evaluation.spendCapUsd,
        },
        capture: (record) => {
            console.error(
                `[run-eval] ${record.questionId} status=${record.error ? record.error.status : 200} citations=${record.answer.citations.length} totalMs=${record.timings.totalMs}`,
            );
        },
    });

    const runFile: EvalRunFile = finalizeRunFile({
        schemaVersion: 1,
        runId: evaluation.runId as string,
        datasetId: catalog.datasetId,
        split: catalog.split,
        config,
        startedAt: null,
        records: result.records,
        totals: computeRunTotals(result.records),
        selfSha256: null,
    });
    const stamped = { ...runFile, startedAt: new Date().toISOString() };

    mkdirSync(args.out, { recursive: true });
    const runPath = path.join(args.out, `${runFile.runId}.json`);
    const receiptPath = path.join(args.out, `${runFile.runId}.receipt.json`);
    if (existsSync(runPath)) {
        throw new Error(`Refusing to overwrite existing run file ${runPath}`);
    }
    writeFileSync(runPath, `${JSON.stringify(stamped, null, 2)}\n`);
    // Freeze the candidate outputs at capture time, before any scoring or
    // evidence contact: the scorer requires this receipt for holdout runs.
    writeFileSync(
        receiptPath,
        `${JSON.stringify(freezeCandidateOutputs(runFile), null, 2)}\n`,
    );

    console.log(
        JSON.stringify(
            {
                runId: runFile.runId,
                datasetId: runFile.datasetId,
                split: runFile.split,
                questionCount: runFile.totals.questionCount,
                errorCount: runFile.totals.errorCount,
                totalCostUsd: result.totalCostUsd,
                aborted: result.aborted,
                abortReason: result.abortReason,
                selfSha256: runFile.selfSha256,
                runPath,
                receiptPath,
            },
            null,
            2,
        ),
    );
    if (result.aborted) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
    main().catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}
