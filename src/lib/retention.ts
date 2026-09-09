/**
 * Data-retention sweep for the runtime/privacy tables.
 *
 * Deletes rows that have aged out of their retention window:
 *   - ask_session_turns: conversation turns older than ASK_SESSION_TTL_DAYS
 *     (default 7, matching the browser-side sidebar's own retention)
 *   - ask_feedback: feedback older than FEEDBACK_RETENTION_DAYS (default 90)
 *   - api_rate_bucket: rate buckets expired for longer than a grace period
 *
 * Cutoffs are computed from the injected `now` and passed as SQL
 * parameters — the DB clock is never consulted, so tests fully control
 * time. Rows exactly at a cutoff are retained (strict `<` comparison).
 *
 * This module is driver-free: callers supply a QueryExecutor (Neon in
 * production via scripts/db/lib/neon-executor, PGlite in tests).
 */

import type { QueryExecutor } from "../../scripts/db/lib/migration-runner";

export interface RetentionSweepOptions {
  /** Reference time for every cutoff. Defaults to the current time. */
  now?: Date;
  /**
   * Session-turn TTL in minutes. Defaults to ASK_SESSION_TTL_DAYS — the same
   * window conversation-store.ts reads and sweeps with.
   */
  sessionTtlMinutes?: number;
  /**
   * Feedback retention in days. Defaults to FEEDBACK_RETENTION_DAYS
   * (env) or 90. Must be >= 1 — a misconfigured env var must fail
   * loudly rather than silently deleting recent feedback.
   */
  feedbackRetentionDays?: number;
  /** Grace period after api_rate_bucket.expires_at, in minutes. Defaults to 60. */
  rateBucketGraceMinutes?: number;
}

export interface RetentionSweepResult {
  sessionTurns: number;
  feedback: number;
  rateBuckets: number;
}

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/**
 * How long a conversation's turns stay recallable.
 *
 * The browser-side sidebar keeps threads for 7 days, so anything shorter here
 * meant reopening a thread the sidebar still listed and silently losing every
 * follow-up's context. Both sides are 7 days.
 *
 * This is the single source of truth for that window: conversation-store.ts
 * reads and sweeps with it, and the nightly sweep below defaults to it. It is
 * deliberately separate from MAX_TURNS, which is the prompt-context budget.
 */
export const DEFAULT_ASK_SESSION_TTL_DAYS = 7;
const MIN_ASK_SESSION_TTL_DAYS = 1;
const MAX_ASK_SESSION_TTL_DAYS = 30;

/** Resolved per call so a changed env takes effect without a cold start. */
export function askSessionTtlDays(): number {
  const raw = process.env.ASK_SESSION_TTL_DAYS;
  if (raw === undefined || raw.trim() === "") return DEFAULT_ASK_SESSION_TTL_DAYS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    console.warn(
      JSON.stringify({
        level: "warn",
        module: "retention",
        op: "askSessionTtlDays",
        msg: "not a number; using the default",
        ASK_SESSION_TTL_DAYS: raw,
        ttlDays: DEFAULT_ASK_SESSION_TTL_DAYS,
      })
    );
    return DEFAULT_ASK_SESSION_TTL_DAYS;
  }
  return Math.min(Math.max(parsed, MIN_ASK_SESSION_TTL_DAYS), MAX_ASK_SESSION_TTL_DAYS);
}

export function askSessionTtlMs(): number {
  return askSessionTtlDays() * DAY_MS;
}

function requireFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number, got: ${value}`);
  }
}

async function deleteOlderThan(
  executor: QueryExecutor,
  table: string,
  column: string,
  cutoff: Date
): Promise<number> {
  const rows = await executor.query({
    text: `DELETE FROM ${table} WHERE ${column} < $1 RETURNING 1 AS deleted`,
    params: [cutoff.toISOString()],
  });
  return rows.length;
}

export async function runRetentionSweep(
  executor: QueryExecutor,
  options: RetentionSweepOptions = {}
): Promise<RetentionSweepResult> {
  const now = options.now ?? new Date();
  const sessionTtlMinutes = options.sessionTtlMinutes ?? (askSessionTtlDays() * DAY_MS) / MINUTE_MS;
  const feedbackRetentionDays =
    options.feedbackRetentionDays ?? Number(process.env.FEEDBACK_RETENTION_DAYS ?? 90);
  const rateBucketGraceMinutes = options.rateBucketGraceMinutes ?? 60;

  requireFinite("sessionTtlMinutes", sessionTtlMinutes);
  requireFinite("rateBucketGraceMinutes", rateBucketGraceMinutes);
  if (!Number.isFinite(feedbackRetentionDays) || feedbackRetentionDays < 1) {
    throw new Error(
      `feedbackRetentionDays must be a number >= 1, got: ${feedbackRetentionDays}. ` +
        "Check the FEEDBACK_RETENTION_DAYS environment variable."
    );
  }

  const sessionTurns = await deleteOlderThan(
    executor,
    "ask_session_turns",
    "created_at",
    new Date(now.getTime() - sessionTtlMinutes * MINUTE_MS)
  );
  const feedback = await deleteOlderThan(
    executor,
    "ask_feedback",
    "created_at",
    new Date(now.getTime() - feedbackRetentionDays * DAY_MS)
  );
  const rateBuckets = await deleteOlderThan(
    executor,
    "api_rate_bucket",
    "expires_at",
    new Date(now.getTime() - rateBucketGraceMinutes * MINUTE_MS)
  );

  return { sessionTurns, feedback, rateBuckets };
}
