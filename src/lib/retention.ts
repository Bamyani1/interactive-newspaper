/**
 * Data-retention sweep for the runtime/privacy tables.
 *
 * Deletes rows that have aged out of their retention window:
 *   - ask_session_turns: conversation turns older than the session TTL
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
    /** Session-turn TTL in minutes. Defaults to 30 (matches the ask UX). */
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

function requireFinite(name: string, value: number): void {
    if (!Number.isFinite(value)) {
        throw new Error(`${name} must be a finite number, got: ${value}`);
    }
}

async function deleteOlderThan(
    executor: QueryExecutor,
    table: string,
    column: string,
    cutoff: Date,
): Promise<number> {
    const rows = await executor.query({
        text: `DELETE FROM ${table} WHERE ${column} < $1 RETURNING 1 AS deleted`,
        params: [cutoff.toISOString()],
    });
    return rows.length;
}

export async function runRetentionSweep(
    executor: QueryExecutor,
    options: RetentionSweepOptions = {},
): Promise<RetentionSweepResult> {
    const now = options.now ?? new Date();
    const sessionTtlMinutes = options.sessionTtlMinutes ?? 30;
    const feedbackRetentionDays =
        options.feedbackRetentionDays ?? Number(process.env.FEEDBACK_RETENTION_DAYS ?? 90);
    const rateBucketGraceMinutes = options.rateBucketGraceMinutes ?? 60;

    requireFinite("sessionTtlMinutes", sessionTtlMinutes);
    requireFinite("rateBucketGraceMinutes", rateBucketGraceMinutes);
    if (!Number.isFinite(feedbackRetentionDays) || feedbackRetentionDays < 1) {
        throw new Error(
            `feedbackRetentionDays must be a number >= 1, got: ${feedbackRetentionDays}. ` +
                "Check the FEEDBACK_RETENTION_DAYS environment variable.",
        );
    }

    const sessionTurns = await deleteOlderThan(
        executor,
        "ask_session_turns",
        "created_at",
        new Date(now.getTime() - sessionTtlMinutes * MINUTE_MS),
    );
    const feedback = await deleteOlderThan(
        executor,
        "ask_feedback",
        "created_at",
        new Date(now.getTime() - feedbackRetentionDays * DAY_MS),
    );
    const rateBuckets = await deleteOlderThan(
        executor,
        "api_rate_bucket",
        "expires_at",
        new Date(now.getTime() - rateBucketGraceMinutes * MINUTE_MS),
    );

    return { sessionTurns, feedback, rateBuckets };
}
