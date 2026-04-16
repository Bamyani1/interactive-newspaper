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
 * Token prices are approximate — gemini-3-flash-preview has no final
 * public price yet. Tune PRICE_PER_MTOKEN as Google publishes rates.
 */

import { neon } from "@neondatabase/serverless";
import type { GenerateContentResponseUsageMetadata } from "@google/genai";

// USD per 1,000,000 tokens. Conservative estimates.
const PRICE_PER_MTOKEN: Record<string, { input: number; output: number }> = {
    "gemini-3-flash-preview": { input: 0.1, output: 0.4 },
    "gemini-embedding-2-preview": { input: 0.025, output: 0 },
};

let DAILY_BUDGET_USD = 0.5;

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
    ) {
        super(
            `Daily AI budget exceeded: $${spentUsd.toFixed(4)} / $${budgetUsd.toFixed(4)}`,
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
    const inputTokens = usage.promptTokenCount ?? 0;
    const outputTokens = usage.candidatesTokenCount ?? 0;
    return (
        (inputTokens * price.input + outputTokens * price.output) / 1_000_000
    );
}

/**
 * Fail-fast guard — throws DailyBudgetExceededError if today's counter
 * is already over the daily budget. Called at the top of /api/ask so
 * the route returns 429 before spending more.
 *
 * DB unavailability is swallowed (budget check skipped with a warning).
 */
export async function checkDailyBudget(): Promise<void> {
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
    context: { requestId?: string; op: string },
): Promise<void> {
    const cost = computeCostUsd(model, usage);
    if (cost === 0) return;
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
            candidatesTokens: usage?.candidatesTokenCount ?? 0,
            costUsd: cost,
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
