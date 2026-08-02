/**
 * AI Cost Tracker
 *
 * Reads usageMetadata from Gemini responses, converts token counts to USD,
 * and accumulates today's total in the Neon `ai_spend_counter` table.
 * checkDailyBudget() throws DailyBudgetExceededError once the day crosses
 * DAILY_BUDGET_USD so the route can return 429 before firing another
 * expensive pipeline.
 *
 * Both recordUsage and checkDailyBudget are best-effort: if Neon is
 * unreachable, they log a warning and return without blocking the
 * caller. That way a transient DB outage doesn't escalate into a
 * user-facing RAG failure.
 *
 * Prices are standard global online-request rates. Reasoning tokens are
 * billed as output and tool-use prompt tokens as input.
 */

import { neon } from "@neondatabase/serverless";
import type {
    EmbedContentResponse,
    GenerateContentResponseUsageMetadata,
} from "@google/genai";
import {
    RAG_EMBEDDING_MODEL,
    RAG_GENERATION_MODEL,
} from "@/src/lib/rag-model-config";
import { getRagEvaluationConfig } from "@/src/lib/rag-evaluation";

// USD per 1,000,000 tokens for standard online requests at global.
const PRICE_PER_MTOKEN: Record<string, { input: number; output: number }> = {
    [RAG_GENERATION_MODEL]: { input: 0.3, output: 2.5 },
    [RAG_EMBEDDING_MODEL]: { input: 0.2, output: 0 },
};
const GEMINI_EMBEDDING_2_IMAGE_USD = 0.00012;

let DAILY_BUDGET_USD = 0.5;
let evaluationRunId: string | null = null;
let evaluationSpendUsd = 0;
let evaluationReservationSequence = 0;
const evaluationReservations = new Map<
    string,
    { runId: string; reservedUsd: number; model: string; op: string }
>();

// Gemini 3.5 Flash-Lite accepts at most 1,048,576 context tokens. Usage
// metadata exposes tool-use and thought counters separately, and our billing
// policy deliberately adds them, so reserve twice the documented input and
// configured output ceilings. The reservation is intentionally conservative:
// it is replaced atomically by actual usage after a successful call.
const MAX_GENERATION_CONTEXT_TOKENS = 1_048_576;
const BILLING_COUNTER_SAFETY_MULTIPLIER = 2;

export interface EvaluationBudgetReservation {
    id: string;
    runId: string;
    reservedUsd: number;
}

function currentEvaluationSpend(runId: string): number {
    if (evaluationRunId !== runId) {
        evaluationRunId = runId;
        evaluationSpendUsd = 0;
        evaluationReservations.clear();
    }
    return evaluationSpendUsd;
}

function addEvaluationSpend(runId: string, costUsd: number): number {
    currentEvaluationSpend(runId);
    evaluationSpendUsd += costUsd;
    return evaluationSpendUsd;
}

function currentEvaluationReservedUsd(runId: string): number {
    currentEvaluationSpend(runId);
    let total = 0;
    for (const reservation of evaluationReservations.values()) {
        if (reservation.runId === runId) total += reservation.reservedUsd;
    }
    return total;
}

/**
 * Reserve the maximum billable amount before dispatching a Google call.
 * This is a synchronous operation, so parallel tool calls cannot race past
 * the aggregate evaluation ceiling on Node's event loop.
 */
export function reserveEvaluationGoogleCall(options: {
    model: string;
    op: string;
    requestId?: string;
    maxOutputTokens?: number;
}): EvaluationBudgetReservation | null {
    const evaluation = getRagEvaluationConfig();
    if (!evaluation.enabled) return null;
    const price = PRICE_PER_MTOKEN[options.model];
    if (!price) {
        throw new Error(
            `Cannot reserve evaluation budget for unpriced model ${options.model}.`,
        );
    }
    const maxInputTokens =
        MAX_GENERATION_CONTEXT_TOKENS * BILLING_COUNTER_SAFETY_MULTIPLIER;
    const maxOutputTokens =
        Math.max(0, options.maxOutputTokens ?? 0) *
        BILLING_COUNTER_SAFETY_MULTIPLIER;
    const reservedUsd =
        (maxInputTokens * price.input + maxOutputTokens * price.output) /
        1_000_000;
    const runId = evaluation.runId!;
    const committed = currentEvaluationSpend(runId);
    const alreadyReserved = currentEvaluationReservedUsd(runId);
    if (committed + alreadyReserved + reservedUsd > evaluation.spendCapUsd) {
        throw new DailyBudgetExceededError(
            committed + alreadyReserved,
            evaluation.spendCapUsd,
            "evaluation_run",
        );
    }
    const id = `${runId}:${++evaluationReservationSequence}:${options.requestId ?? "request"}:${options.op}`;
    evaluationReservations.set(id, {
        runId,
        reservedUsd,
        model: options.model,
        op: options.op,
    });
    return { id, runId, reservedUsd };
}

export function releaseEvaluationGoogleCall(
    reservation: EvaluationBudgetReservation | null,
): void {
    if (!reservation) return;
    evaluationReservations.delete(reservation.id);
}

export function settleEvaluationGoogleCall(
    reservation: EvaluationBudgetReservation | null,
    actualCostUsd: number,
): void {
    if (!reservation) return;
    const active = evaluationReservations.get(reservation.id);
    if (!active || active.runId !== reservation.runId) {
        throw new Error(`Unknown or stale evaluation reservation ${reservation.id}.`);
    }
    if (actualCostUsd > active.reservedUsd + 1e-9) {
        throw new Error(
            `Google call cost $${actualCostUsd.toFixed(6)} exceeded its conservative $${active.reservedUsd.toFixed(6)} reservation.`,
        );
    }
    evaluationReservations.delete(reservation.id);
    const evaluation = getRagEvaluationConfig();
    const nextTotal = addEvaluationSpend(reservation.runId, actualCostUsd);
    if (nextTotal + currentEvaluationReservedUsd(reservation.runId) > evaluation.spendCapUsd + 1e-9) {
        throw new DailyBudgetExceededError(
            nextTotal,
            evaluation.spendCapUsd,
            "evaluation_run",
        );
    }
}

// Lazy init — importing this module without DATABASE_URL (e.g. in the
// test runner when DB-dependent tests are mocked out) must not throw.
let _sql: ReturnType<typeof neon> | null = null;
function getSql() {
    if (_sql !== null) return _sql;
    const url = process.env.DATABASE_URL;
    if (!url) return null;
    _sql = neon(url);
    return _sql;
}

export class DailyBudgetExceededError extends Error {
    constructor(
        public readonly spentUsd: number,
        public readonly budgetUsd: number,
        public readonly scope: "online_daily" | "evaluation_run" = "online_daily",
    ) {
        super(
            `${scope === "evaluation_run" ? "Evaluation" : "Daily AI"} budget exceeded: $${spentUsd.toFixed(4)} / $${budgetUsd.toFixed(4)}`,
        );
        this.name = "DailyBudgetExceededError";
    }
}

function today(): string {
    return new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
}

export function computeCostUsd(
    model: string,
    usage: GenerateContentResponseUsageMetadata | undefined,
): number {
    if (!usage) return 0;
    const price = PRICE_PER_MTOKEN[model];
    if (!price) return 0;
    const inputTokens =
        (usage.promptTokenCount ?? 0) + (usage.toolUsePromptTokenCount ?? 0);
    const outputTokens =
        (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0);
    return (
        (inputTokens * price.input + outputTokens * price.output) / 1_000_000
    );
}

export function embeddingTokenCount(response: EmbedContentResponse): number {
    const exact = response.embeddings?.reduce(
        (sum, embedding) => sum + (embedding.statistics?.tokenCount ?? 0),
        0,
    );
    if (exact && exact > 0) return exact;

    // Vertex exposes billable characters even when per-item token statistics
    // are absent. The fallback is explicitly an estimate and is only used for
    // the local spend guard/telemetry, never billing reconciliation.
    const billableChars = response.metadata?.billableCharacterCount ?? 0;
    return Math.ceil(billableChars / 4);
}

export function computeEmbeddingCostUsd(
    model: string,
    response: EmbedContentResponse,
    options: { imageCount?: number } = {},
): number {
    const price = PRICE_PER_MTOKEN[model];
    if (!price) return 0;
    const textCost = (embeddingTokenCount(response) * price.input) / 1_000_000;
    const imageCost =
        model === RAG_EMBEDDING_MODEL
            ? (options.imageCount ?? 0) * GEMINI_EMBEDDING_2_IMAGE_USD
            : 0;
    return textCost + imageCost;
}

/** Execute, reserve, settle, and record one non-streaming generation call. */
export async function executeTrackedGenerationCall<
    T extends { usageMetadata?: GenerateContentResponseUsageMetadata },
>(options: {
    model: string;
    maxOutputTokens: number;
    requestId?: string;
    op: string;
    call: () => Promise<T>;
}): Promise<T> {
    const reservation = reserveEvaluationGoogleCall(options);
    try {
        const response = await options.call();
        if (reservation) {
            settleEvaluationGoogleCall(
                reservation,
                computeCostUsd(options.model, response.usageMetadata),
            );
        }
        void recordUsage(options.model, response.usageMetadata, {
            requestId: options.requestId,
            op: options.op,
            evaluationCostAlreadyRecorded: Boolean(reservation),
        });
        return response;
    } catch (error) {
        releaseEvaluationGoogleCall(reservation);
        throw error;
    }
}

/** Execute, reserve, settle, and record one embedding call. */
export async function executeTrackedEmbeddingCall<
    T extends EmbedContentResponse,
>(options: {
    model: string;
    requestId?: string;
    op: string;
    imageCount?: number;
    call: () => Promise<T>;
}): Promise<T> {
    const reservation = reserveEvaluationGoogleCall({
        model: options.model,
        requestId: options.requestId,
        op: options.op,
        maxOutputTokens: 0,
    });
    try {
        const response = await options.call();
        if (reservation) {
            settleEvaluationGoogleCall(
                reservation,
                computeEmbeddingCostUsd(options.model, response, {
                    imageCount: options.imageCount,
                }),
            );
        }
        void recordEmbeddingUsage(options.model, response, {
            requestId: options.requestId,
            op: options.op,
            imageCount: options.imageCount,
            evaluationCostAlreadyRecorded: Boolean(reservation),
        });
        return response;
    } catch (error) {
        releaseEvaluationGoogleCall(reservation);
        throw error;
    }
}

/**
 * Fail-fast guard — throws DailyBudgetExceededError if today's counter
 * is already over the daily budget. Called at the top of /api/ask so
 * the route returns 429 before spending more.
 *
 * DB unavailability is swallowed (budget check skipped with a warning).
 */
export async function checkDailyBudget(): Promise<void> {
    const evaluation = getRagEvaluationConfig();
    if (evaluation.enabled) {
        const spent = currentEvaluationSpend(evaluation.runId!);
        if (
            spent + currentEvaluationReservedUsd(evaluation.runId!) >=
            evaluation.spendCapUsd
        ) {
            throw new DailyBudgetExceededError(
                spent,
                evaluation.spendCapUsd,
                "evaluation_run",
            );
        }
        return;
    }
    const sql = getSql();
    if (!sql) return; // no DB configured — skip check
    const day = today();
    let spent = 0;
    try {
        const rows = (await sql`
            SELECT spent_usd FROM ai_spend_counter WHERE day = ${day}
        `) as Array<{ spent_usd: string | number }>;
        spent = rows.length > 0 ? Number(rows[0].spent_usd) : 0;
    } catch (err) {
        console.warn(
            JSON.stringify({
                level: "warn",
                module: "cost-tracker",
                op: "checkDailyBudget",
                msg: "budget check skipped (db error)",
                err: err instanceof Error ? err.message : String(err),
            }),
        );
        return;
    }
    if (spent >= DAILY_BUDGET_USD) {
        throw new DailyBudgetExceededError(spent, DAILY_BUDGET_USD);
    }
}

/**
 * Record one Gemini call's cost. Fire-and-forget from the route; a DB
 * failure logs a warning but doesn't propagate (the user's request
 * shouldn't fail because accounting fell behind).
 */
export async function recordUsage(
    model: string,
    usage: GenerateContentResponseUsageMetadata | undefined,
    context: {
        requestId?: string;
        op: string;
        evaluationCostAlreadyRecorded?: boolean;
    },
): Promise<void> {
    const cost = computeCostUsd(model, usage);
    if (cost === 0) return;
    const evaluation = getRagEvaluationConfig();
    let evaluationTotalUsd: number | undefined;
    if (evaluation.enabled) {
        evaluationTotalUsd = context.evaluationCostAlreadyRecorded
            ? currentEvaluationSpend(evaluation.runId!)
            : addEvaluationSpend(evaluation.runId!, cost);
    } else {
        const sql = getSql();
        if (!sql) return; // no DB configured — drop on the floor
        const day = today();
        try {
            await sql`
                INSERT INTO ai_spend_counter (day, spent_usd)
                VALUES (${day}, ${cost})
                ON CONFLICT (day) DO UPDATE
                  SET spent_usd = ai_spend_counter.spent_usd + ${cost}
            `;
        } catch (err) {
            console.warn(
                JSON.stringify({
                    level: "warn",
                    module: "cost-tracker",
                    op: "recordUsage",
                    msg: "usage write failed",
                    err: err instanceof Error ? err.message : String(err),
                }),
            );
            return;
        }
    }
    // Telemetry line with level:info emitted via console.warn (lint
    // rule only allows warn/error; the level field is the semantic bit).
    console.warn(
        JSON.stringify({
            level: "info",
            module: "cost-tracker",
            op: context.op,
            requestId: context.requestId,
            model,
            promptTokens: usage?.promptTokenCount ?? 0,
            toolUsePromptTokens: usage?.toolUsePromptTokenCount ?? 0,
            candidatesTokens: usage?.candidatesTokenCount ?? 0,
            thoughtsTokens: usage?.thoughtsTokenCount ?? 0,
            costUsd: cost,
            evaluationRunId: evaluation.runId ?? undefined,
            evaluationTotalUsd,
        }),
    );
}

export async function recordEmbeddingUsage(
    model: string,
    response: EmbedContentResponse,
    context: {
        requestId?: string;
        op: string;
        imageCount?: number;
        evaluationCostAlreadyRecorded?: boolean;
    },
): Promise<void> {
    const tokens = embeddingTokenCount(response);
    const cost = computeEmbeddingCostUsd(model, response, {
        imageCount: context.imageCount,
    });
    if (cost === 0) return;
    const evaluation = getRagEvaluationConfig();
    let evaluationTotalUsd: number | undefined;
    const sql = evaluation.enabled ? null : getSql();
    if (evaluation.enabled) {
        evaluationTotalUsd = context.evaluationCostAlreadyRecorded
            ? currentEvaluationSpend(evaluation.runId!)
            : addEvaluationSpend(evaluation.runId!, cost);
    } else if (sql) {
        const day = today();
        try {
            await sql`
                INSERT INTO ai_spend_counter (day, spent_usd)
                VALUES (${day}, ${cost})
                ON CONFLICT (day) DO UPDATE
                  SET spent_usd = ai_spend_counter.spent_usd + ${cost}
            `;
        } catch (err) {
            console.warn(
                JSON.stringify({
                    level: "warn",
                    module: "cost-tracker",
                    op: "recordEmbeddingUsage",
                    msg: "embedding usage write failed",
                    err: err instanceof Error ? err.message : String(err),
                }),
            );
        }
    }

    console.warn(
        JSON.stringify({
            level: "info",
            module: "cost-tracker",
            op: context.op,
            requestId: context.requestId,
            model,
            inputTokens: tokens,
            imageCount: context.imageCount ?? 0,
            costUsd: cost,
            evaluationRunId: evaluation.runId ?? undefined,
            evaluationTotalUsd,
        }),
    );
}

// Test hooks. Kept exported so production callers don't import them
// accidentally — names carry the `_…ForTests` suffix per convention.
export function _setDailyBudgetForTests(usd: number): void {
    DAILY_BUDGET_USD = usd;
}

export function _getDailyBudgetForTests(): number {
    return DAILY_BUDGET_USD;
}

export function _getEvaluationSpendForTests(): number {
    return evaluationSpendUsd;
}

export function _getEvaluationReservedForTests(): number {
    const runId = evaluationRunId;
    return runId ? currentEvaluationReservedUsd(runId) : 0;
}

export function _resetEvaluationSpendForTests(): void {
    evaluationRunId = null;
    evaluationSpendUsd = 0;
    evaluationReservationSequence = 0;
    evaluationReservations.clear();
}
