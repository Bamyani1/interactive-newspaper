/** @vitest-environment node */
/**
 * PGlite-backed tests for runRetentionSweep. Time is fully injected —
 * every row is seeded with an explicit created_at/expires_at and the
 * sweep receives an explicit `now`, so nothing depends on wall clocks
 * (JS or DB).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../scripts/db/lib/migration-runner";
import { createTestDb, MIGRATIONS_DIR, type TestDb } from "../db/helpers/pglite";
import { runRetentionSweep } from "@/src/lib/retention";

const NOW = new Date("2026-08-01T12:00:00.000Z");

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

function minutesBefore(minutes: number): string {
    return new Date(NOW.getTime() - minutes * MINUTE_MS).toISOString();
}

function daysBefore(days: number): string {
    return new Date(NOW.getTime() - days * DAY_MS).toISOString();
}

describe("runRetentionSweep", () => {
    let db: TestDb;

    beforeAll(async () => {
        db = await createTestDb();
        await runMigrations(db.executor, { dir: MIGRATIONS_DIR });
    }, 30000);

    afterAll(async () => {
        await db.close();
    });

    beforeEach(async () => {
        await db.pg.exec(
            "TRUNCATE ask_session_turns, ask_feedback, api_rate_bucket",
        );
    });

    async function seedSessionTurn(createdAt: string): Promise<void> {
        await db.executor.query({
            text: `INSERT INTO ask_session_turns (session_id, question, answer, created_at)
                   VALUES ('session-1', 'q', 'a', $1)`,
            params: [createdAt],
        });
    }

    async function seedFeedback(createdAt: string): Promise<void> {
        await db.executor.query({
            text: `INSERT INTO ask_feedback (request_id, question, answer, vote, created_at)
                   VALUES ('req-1', 'q', 'a', 'up', $1)`,
            params: [createdAt],
        });
    }

    async function seedRateBucket(key: string, expiresAt: string): Promise<void> {
        await db.executor.query({
            text: `INSERT INTO api_rate_bucket (key, count, expires_at)
                   VALUES ($1, 1, $2)`,
            params: [key, expiresAt],
        });
    }

    async function countRows(table: string): Promise<number> {
        const rows = await db.executor.query({
            text: `SELECT count(*)::int AS n FROM ${table}`,
        });
        return Number(rows[0].n);
    }

    it("deletes expired rows from all three tables and returns the counts", async () => {
        // Session TTL default 30 min → cutoff 11:30:00Z.
        await seedSessionTurn(minutesBefore(120)); // expired
        await seedSessionTurn(minutesBefore(31)); // expired
        await seedSessionTurn(minutesBefore(15)); // fresh
        // Feedback default 90 days → cutoff 2026-05-03T12:00:00Z.
        await seedFeedback(daysBefore(91)); // expired
        await seedFeedback(daysBefore(2)); // fresh
        // Rate-bucket grace default 60 min → cutoff 11:00:00Z.
        await seedRateBucket("ask:1.1.1.1", minutesBefore(180)); // stale
        await seedRateBucket("ask:2.2.2.2", minutesBefore(30)); // within grace
        await seedRateBucket("ask:3.3.3.3", minutesBefore(-60)); // future expiry

        const result = await runRetentionSweep(db.executor, { now: NOW });

        expect(result).toEqual({ sessionTurns: 2, feedback: 1, rateBuckets: 1 });
        expect(await countRows("ask_session_turns")).toBe(1);
        expect(await countRows("ask_feedback")).toBe(1);
        expect(await countRows("api_rate_bucket")).toBe(2);
    });

    it("retains rows exactly at each cutoff (strict less-than)", async () => {
        await seedSessionTurn(minutesBefore(30)); // exactly at TTL cutoff
        await seedFeedback(daysBefore(90)); // exactly at retention cutoff
        await seedRateBucket("ask:1.1.1.1", minutesBefore(60)); // exactly at grace cutoff

        const result = await runRetentionSweep(db.executor, { now: NOW });

        expect(result).toEqual({ sessionTurns: 0, feedback: 0, rateBuckets: 0 });
        expect(await countRows("ask_session_turns")).toBe(1);
        expect(await countRows("ask_feedback")).toBe(1);
        expect(await countRows("api_rate_bucket")).toBe(1);
    });

    it("respects a feedbackRetentionDays override without touching process.env", async () => {
        await seedFeedback(daysBefore(8)); // outside a 7-day window
        await seedFeedback(daysBefore(6)); // inside a 7-day window

        const result = await runRetentionSweep(db.executor, {
            now: NOW,
            feedbackRetentionDays: 7,
        });

        expect(result.feedback).toBe(1);
        expect(await countRows("ask_feedback")).toBe(1);
        expect(process.env.FEEDBACK_RETENTION_DAYS).toBeUndefined();
    });

    it("is idempotent: a second sweep at the same time deletes nothing", async () => {
        await seedSessionTurn(minutesBefore(120));
        await seedFeedback(daysBefore(365));
        await seedRateBucket("ask:1.1.1.1", minutesBefore(180));

        const first = await runRetentionSweep(db.executor, { now: NOW });
        expect(first).toEqual({ sessionTurns: 1, feedback: 1, rateBuckets: 1 });

        const second = await runRetentionSweep(db.executor, { now: NOW });
        expect(second).toEqual({ sessionTurns: 0, feedback: 0, rateBuckets: 0 });
    });

    it("throws on feedbackRetentionDays < 1 or non-numeric values", async () => {
        await expect(
            runRetentionSweep(db.executor, { now: NOW, feedbackRetentionDays: 0 }),
        ).rejects.toThrow(/feedbackRetentionDays/);
        await expect(
            runRetentionSweep(db.executor, { now: NOW, feedbackRetentionDays: -3 }),
        ).rejects.toThrow(/feedbackRetentionDays/);
        // A garbage FEEDBACK_RETENTION_DAYS env value arrives here as NaN.
        await expect(
            runRetentionSweep(db.executor, {
                now: NOW,
                feedbackRetentionDays: Number("banana"),
            }),
        ).rejects.toThrow(/feedbackRetentionDays/);
    });
});
