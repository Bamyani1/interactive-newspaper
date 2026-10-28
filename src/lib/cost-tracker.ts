/**
 * AI Cost Tracker
 *
 * Reads usage from Claude responses, converts token counts to USD,
 * and accumulates today's total in the Neon `ai_spend_by_scope` table, one
 * row per UTC day per environment (see spendScope()).
 * checkDailyBudget() throws DailyBudgetExceededError once the day crosses
 * the RAG_DAILY_BUDGET_USD ceiling so the route can return 429 before
 * firing another expensive pipeline.
 *
 * Both recordUsage and checkDailyBudget are best-effort: if Neon is
 * unreachable, they log a warning and return without blocking the
 * caller. That way a transient DB outage doesn't escalate into a
 * user-facing RAG failure.
 *
 * Prices are standard online-request rates. Thinking tokens are billed as
 * output; cache reads and writes as discounted and surcharged input.
 */

import { neon } from "@neondatabase/serverless";
import {
  RAG_ANSWER_PROFILES,
  RAG_EMBEDDING_MODEL,
  RAG_GENERATION_MODEL,
  RAG_IMAGE_EMBEDDING_MODEL,
  RAG_RERANK_MODEL,
} from "@/src/lib/rag-model-config";
import { getRagEvaluationConfig } from "@/src/lib/rag-evaluation";
import { runWithDbTimeout } from "@/src/lib/db-timeout";

interface TokenPrice {
  input: number;
  output: number;
}

// USD per 1,000,000 tokens for standard online requests. Haiku 5.5 bills a
// prompt over 100K tokens at a higher rate for the whole call. Voyage rates
// are list prices, so calls inside the free allowance are counted too.
const PRICE_PER_MTOKEN: Record<string, TokenPrice & { longPrompt?: TokenPrice }> = {
  [RAG_GENERATION_MODEL]: { input: 0.1, output: 0.5, longPrompt: { input: 0.5, output: 2.5 } },
  [RAG_ANSWER_PROFILES["sonnet-medium"].model]: { input: 2, output: 10 },
  [RAG_EMBEDDING_MODEL]: { input: 0.12, output: 0 },
  [RAG_IMAGE_EMBEDDING_MODEL]: { input: 0.12, output: 0 },
  [RAG_RERANK_MODEL]: { input: 0.05, output: 0 },
};
// voyage-multimodal-3.5 bills pixels apart from text tokens.
const VOYAGE_USD_PER_BILLION_PIXELS = 0.6;
const LONG_PROMPT_TOKENS = 100_000;
// Claude bills cache reads at a tenth of the input rate and 5-minute cache
// writes at 1.25 times it.
const CACHE_READ_RATE = 0.1;
const CACHE_WRITE_RATE = 1.25;

/** The token counters on a Claude response (the SDK's `Usage`). */
export interface GenerationUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

/** The usage block on a Voyage response (embeddings or rerank). */
export interface VoyageUsage {
  total_tokens: number;
  /** Multimodal embeddings only, with image_pixels. */
  text_tokens?: number;
  image_pixels?: number;
}

// The daily cap comes from RAG_DAILY_BUDGET_USD so it can be raised for a
// launch or lowered for a quiet month without a deploy. The hard maximum is
// the real safety property: an operator fat-fingering an extra zero must not
// be able to authorize an unbounded day of spend.
const DEFAULT_DAILY_BUDGET_USD = 2;
const MAX_DAILY_BUDGET_USD = 50;

// Set only by _setDailyBudgetForTests; null means "read the environment".
let dailyBudgetOverrideUsd: number | null = null;

function warnBudget(msg: string, raw: string, budgetUsd: number): void {
  console.warn(
    JSON.stringify({
      level: "warn",
      module: "cost-tracker",
      op: "dailyBudget",
      msg,
      RAG_DAILY_BUDGET_USD: raw,
      budgetUsd,
    })
  );
}

/**
 * Resolved per call rather than at module load so a changed environment
 * takes effect on the next request instead of the next cold start.
 */
function dailyBudgetUsd(): number {
  if (dailyBudgetOverrideUsd !== null) return dailyBudgetOverrideUsd;
  const raw = process.env.RAG_DAILY_BUDGET_USD;
  if (raw === undefined || raw.trim() === "") return DEFAULT_DAILY_BUDGET_USD;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    warnBudget("not a positive number; using the default", raw, DEFAULT_DAILY_BUDGET_USD);
    return DEFAULT_DAILY_BUDGET_USD;
  }
  if (parsed > MAX_DAILY_BUDGET_USD) {
    warnBudget("above the hard maximum; clamped", raw, MAX_DAILY_BUDGET_USD);
    return MAX_DAILY_BUDGET_USD;
  }
  return parsed;
}

// Bounded fail-open for the online path. When Neon is unreachable the daily
// counter can neither be read nor written, so the hard cap above can't be
// enforced. Skipping the cap entirely means unbounded blind spend during an
// outage; failing closed turns any DB blip into a full /api/ask outage. Instead
// we accumulate the estimated cost of calls made while the DB is down and start
// refusing once that estimate crosses OUTAGE_BUDGET_USD. Any successful DB
// read/write means Neon recovered and resets the accumulator to 0.
const OUTAGE_BUDGET_USD = 0.5;
let outageSpendUsd = 0;

// The budget read sits on the request path, so it gets a timer like every
// other request-path query.
const BUDGET_READ_TIMEOUT_MS = 2_000;

let evaluationRunId: string | null = null;
let evaluationSpendUsd = 0;
let evaluationReservationSequence = 0;
const evaluationReservations = new Map<
  string,
  { runId: string; reservedUsd: number; model: string; op: string }
>();

// The generation models we bill against accept at most 1M context tokens
// (Haiku 5.5 and Sonnet 5.5 alike). Reserve twice that and the configured
// output ceiling at the highest rate, which also covers every input token
// being a cache write. The reservation is intentionally conservative: it is
// replaced atomically by actual usage after a successful call.
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
  const priced = PRICE_PER_MTOKEN[options.model];
  if (!priced) {
    throw new Error(`Cannot reserve evaluation budget for unpriced model ${options.model}.`);
  }
  const price = priced.longPrompt ?? priced;
  const maxInputTokens = MAX_GENERATION_CONTEXT_TOKENS * BILLING_COUNTER_SAFETY_MULTIPLIER;
  const maxOutputTokens =
    Math.max(0, options.maxOutputTokens ?? 0) * BILLING_COUNTER_SAFETY_MULTIPLIER;
  const reservedUsd = (maxInputTokens * price.input + maxOutputTokens * price.output) / 1_000_000;
  const runId = evaluation.runId!;
  const committed = currentEvaluationSpend(runId);
  const alreadyReserved = currentEvaluationReservedUsd(runId);
  if (committed + alreadyReserved + reservedUsd > evaluation.spendCapUsd) {
    throw new DailyBudgetExceededError(
      committed + alreadyReserved,
      evaluation.spendCapUsd,
      "evaluation_run"
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

export function releaseEvaluationGoogleCall(reservation: EvaluationBudgetReservation | null): void {
  if (!reservation) return;
  evaluationReservations.delete(reservation.id);
}

export function settleEvaluationGoogleCall(
  reservation: EvaluationBudgetReservation | null,
  actualCostUsd: number
): void {
  if (!reservation) return;
  const active = evaluationReservations.get(reservation.id);
  if (!active || active.runId !== reservation.runId) {
    throw new Error(`Unknown or stale evaluation reservation ${reservation.id}.`);
  }
  if (actualCostUsd > active.reservedUsd + 1e-9) {
    throw new Error(
      `Google call cost $${actualCostUsd.toFixed(6)} exceeded its conservative $${active.reservedUsd.toFixed(6)} reservation.`
    );
  }
  evaluationReservations.delete(reservation.id);
  const evaluation = getRagEvaluationConfig();
  const nextTotal = addEvaluationSpend(reservation.runId, actualCostUsd);
  if (nextTotal + currentEvaluationReservedUsd(reservation.runId) > evaluation.spendCapUsd + 1e-9) {
    throw new DailyBudgetExceededError(nextTotal, evaluation.spendCapUsd, "evaluation_run");
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
    public readonly scope: "online_daily" | "evaluation_run" = "online_daily"
  ) {
    super(
      `${scope === "evaluation_run" ? "Evaluation" : "Daily AI"} budget exceeded: $${spentUsd.toFixed(4)} / $${budgetUsd.toFixed(4)}`
    );
    this.name = "DailyBudgetExceededError";
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
}

export type SpendScope = "production" | "preview" | "development" | "local";

/**
 * Which daily ledger this process spends against. Vercel sets VERCEL_ENV on
 * every deployment; anything else (next dev, scripts, tests) is "local".
 * All of them used to share one row per day, so an afternoon of local
 * testing could exhaust the budget production readers were capped by.
 */
export function spendScope(): SpendScope {
  const env = process.env.VERCEL_ENV;
  return env === "production" || env === "preview" || env === "development" ? env : "local";
}

/**
 * How long until the daily counter starts over — the boundary `today()`
 * rolls on, which is UTC midnight. The budget refusal quotes this, and it
 * used to quote a flat hour instead: the reader was told "try again
 * tomorrow" above a countdown that said 60m, and after that hour passed
 * the retry failed exactly as before.
 */
export function secondsUntilBudgetReset(now: Date = new Date()): number {
  const nextMidnightUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((nextMidnightUtc - now.getTime()) / 1000));
}

export function computeCostUsd(model: string, usage: GenerationUsage | undefined): number {
  if (!usage) return 0;
  const priced = PRICE_PER_MTOKEN[model];
  if (!priced) return 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const promptTokens = usage.input_tokens + cacheRead + cacheWrite;
  const price =
    priced.longPrompt && promptTokens > LONG_PROMPT_TOKENS ? priced.longPrompt : priced;
  const inputUsd =
    (usage.input_tokens + cacheRead * CACHE_READ_RATE + cacheWrite * CACHE_WRITE_RATE) *
    price.input;
  return (inputUsd + usage.output_tokens * price.output) / 1_000_000;
}

/** Billable tokens: the multimodal model counts text apart from pixels. */
export function voyageTokenCount(usage: VoyageUsage | undefined): number {
  if (!usage) return 0;
  return usage.text_tokens ?? usage.total_tokens;
}

/** Prices a Voyage embeddings or rerank call from its usage block. */
export function computeEmbeddingCostUsd(model: string, usage: VoyageUsage | undefined): number {
  const price = PRICE_PER_MTOKEN[model];
  if (!price || !usage) return 0;
  const textCost = (voyageTokenCount(usage) * price.input) / 1_000_000;
  const pixelCost = ((usage.image_pixels ?? 0) * VOYAGE_USD_PER_BILLION_PIXELS) / 1_000_000_000;
  return textCost + pixelCost;
}

/** Execute, reserve, settle, and record one non-streaming generation call. */
export async function executeTrackedGenerationCall<T extends { usage?: GenerationUsage }>(options: {
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
      settleEvaluationGoogleCall(reservation, computeCostUsd(options.model, response.usage));
    }
    void recordUsage(options.model, response.usage, {
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

/** Execute, reserve, settle, and record one Voyage call (embeddings or rerank). */
export async function executeTrackedEmbeddingCall<T extends { usage?: VoyageUsage }>(options: {
  model: string;
  requestId?: string;
  op: string;
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
        computeEmbeddingCostUsd(options.model, response.usage)
      );
    }
    void recordEmbeddingUsage(options.model, response.usage, {
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
    if (spent + currentEvaluationReservedUsd(evaluation.runId!) >= evaluation.spendCapUsd) {
      throw new DailyBudgetExceededError(spent, evaluation.spendCapUsd, "evaluation_run");
    }
    return;
  }
  const sql = getSql();
  if (!sql) return; // no DB configured — skip check
  const day = today();
  let spent = 0;
  try {
    // Raced against a timer: this is the last await before the first model
    // call, and Neon's serverless driver has no AbortSignal support, so a
    // hung read would otherwise stall /api/ask indefinitely. A timeout is
    // treated exactly like any other DB error — bounded fail-open below.
    const rows = (await runWithDbTimeout(
      "checkDailyBudget",
      () => sql`
            SELECT spent_usd FROM ai_spend_by_scope
            WHERE day = ${day} AND scope = ${spendScope()}
        `,
      BUDGET_READ_TIMEOUT_MS
    )) as Array<{ spent_usd: string | number }>;
    spent = rows.length > 0 ? Number(rows[0].spent_usd) : 0;
    outageSpendUsd = 0; // DB reachable — clear any accumulated outage estimate
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: "warn",
        module: "cost-tracker",
        op: "checkDailyBudget",
        msg: "budget check skipped (db error)",
        outageSpendUsd,
        err: err instanceof Error ? err.message : String(err),
      })
    );
    // Bounded fail-open: once blind spend during the outage crosses the
    // ceiling, refuse further calls (429) instead of spending unbounded.
    if (outageSpendUsd >= OUTAGE_BUDGET_USD) {
      throw new DailyBudgetExceededError(outageSpendUsd, OUTAGE_BUDGET_USD);
    }
    return;
  }
  const budgetUsd = dailyBudgetUsd();
  if (spent >= budgetUsd) {
    throw new DailyBudgetExceededError(spent, budgetUsd);
  }
}

/**
 * Record one model call's cost. Fire-and-forget from the route; a DB
 * failure logs a warning but doesn't propagate (the user's request
 * shouldn't fail because accounting fell behind).
 */
export async function recordUsage(
  model: string,
  usage: GenerationUsage | undefined,
  context: {
    requestId?: string;
    op: string;
    evaluationCostAlreadyRecorded?: boolean;
  }
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
                INSERT INTO ai_spend_by_scope (day, scope, spent_usd)
                VALUES (${day}, ${spendScope()}, ${cost})
                ON CONFLICT (day, scope) DO UPDATE
                  SET spent_usd = ai_spend_by_scope.spent_usd + ${cost},
                      updated_at = now()
            `;
      outageSpendUsd = 0; // write succeeded — Neon reachable
    } catch (err) {
      // Blind spend during an outage; bounds the fail-open cap in
      // checkDailyBudget so an unreachable DB can't be spent past.
      outageSpendUsd += cost;
      console.warn(
        JSON.stringify({
          level: "warn",
          module: "cost-tracker",
          op: "recordUsage",
          msg: "usage write failed",
          outageSpendUsd,
          err: err instanceof Error ? err.message : String(err),
        })
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
      inputTokens: usage?.input_tokens ?? 0,
      cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
      cacheWriteTokens: usage?.cache_creation_input_tokens ?? 0,
      outputTokens: usage?.output_tokens ?? 0,
      costUsd: cost,
      evaluationRunId: evaluation.runId ?? undefined,
      evaluationTotalUsd,
    })
  );
}

export async function recordEmbeddingUsage(
  model: string,
  usage: VoyageUsage | undefined,
  context: {
    requestId?: string;
    op: string;
    evaluationCostAlreadyRecorded?: boolean;
  }
): Promise<void> {
  const tokens = voyageTokenCount(usage);
  const cost = computeEmbeddingCostUsd(model, usage);
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
                INSERT INTO ai_spend_by_scope (day, scope, spent_usd)
                VALUES (${day}, ${spendScope()}, ${cost})
                ON CONFLICT (day, scope) DO UPDATE
                  SET spent_usd = ai_spend_by_scope.spent_usd + ${cost},
                      updated_at = now()
            `;
      outageSpendUsd = 0; // write succeeded — Neon reachable
    } catch (err) {
      outageSpendUsd += cost; // blind spend during outage (see recordUsage)
      console.warn(
        JSON.stringify({
          level: "warn",
          module: "cost-tracker",
          op: "recordEmbeddingUsage",
          msg: "embedding usage write failed",
          outageSpendUsd,
          err: err instanceof Error ? err.message : String(err),
        })
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
      imagePixels: usage?.image_pixels ?? 0,
      costUsd: cost,
      evaluationRunId: evaluation.runId ?? undefined,
      evaluationTotalUsd,
    })
  );
}

// Test hooks. Kept exported so production callers don't import them
// accidentally — names carry the `_…ForTests` suffix per convention.
/** Pass null to clear the override and read RAG_DAILY_BUDGET_USD again. */
export function _setDailyBudgetForTests(usd: number | null): void {
  dailyBudgetOverrideUsd = usd;
}

export function _getDailyBudgetForTests(): number {
  return dailyBudgetUsd();
}

export function _getOutageSpendForTests(): number {
  return outageSpendUsd;
}

export function _resetOutageSpendForTests(): void {
  outageSpendUsd = 0;
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
