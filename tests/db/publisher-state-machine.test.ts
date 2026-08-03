/** @vitest-environment node */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../scripts/db/lib/migration-runner";
import type { QueryExecutor, SqlStatement } from "../../scripts/db/lib/migration-runner";
import {
    IllegalTransitionError,
    PIPELINE_STATES,
    PUBLICATION_STATES,
    activateRevision,
    canTransition,
    createRun,
    getRun,
    resumeRun,
    rollbackActiveRevision,
    transitionRun,
    type PipelineState,
    type PublicationState,
} from "../../src/server/publisher/state-machine";
import { ulid } from "../../src/server/identity/ulid";
import { MIGRATIONS_DIR, createTestDb, type TestDb } from "./helpers/pglite";

describe("publisher state machine", () => {
    let db: TestDb;

    beforeAll(async () => {
        db = await createTestDb();
        await runMigrations(db.executor, { dir: MIGRATIONS_DIR });
    });

    afterAll(async () => {
        await db.close();
    });

    /** Seeds a fresh fixture issue plus one staged edition revision. */
    async function seedIssue(date: string): Promise<{ issueId: string; revisionId: string }> {
        const issueId = ulid();
        const revisionId = ulid();
        await db.pg.query(`INSERT INTO issues (id, canonical_date) VALUES ($1, $2)`, [
            issueId,
            date,
        ]);
        await db.pg.query(
            `INSERT INTO edition_revisions (id, issue_id, revision_hash) VALUES ($1, $2, $3)`,
            [revisionId, issueId, `hash-${revisionId}`],
        );
        return { issueId, revisionId };
    }

    async function runEvents(
        runId: string,
    ): Promise<Array<{ from_state: string | null; to_state: string }>> {
        const { rows } = await db.pg.query<{ from_state: string | null; to_state: string }>(
            `SELECT from_state, to_state FROM publication_run_events
             WHERE run_id = $1 ORDER BY id`,
            [runId],
        );
        return rows;
    }

    async function activePointer(issueId: string): Promise<string | null> {
        const { rows } = await db.pg.query<{ active_edition_revision_id: string | null }>(
            `SELECT active_edition_revision_id FROM issues WHERE id = $1`,
            [issueId],
        );
        return rows[0].active_edition_revision_id;
    }

    /** Walks a run forward one legal step at a time up to (and including) target. */
    async function walkTo(runId: string, target: PipelineState): Promise<void> {
        const targetIndex = PIPELINE_STATES.indexOf(target);
        for (let i = 1; i <= targetIndex; i += 1) {
            await transitionRun(db.executor, runId, PIPELINE_STATES[i]);
        }
    }

    /**
     * Simulates a crash mid-batch: every statement of the batch executes inside
     * a real transaction which then throws, so PGlite rolls everything back and
     * the error propagates to the caller exactly as a lost connection would.
     */
    function crashingExecutor(): QueryExecutor {
        return {
            query: (stmt: SqlStatement) => db.executor.query(stmt),
            async transactionBatch(stmts: SqlStatement[]): Promise<void> {
                await db.pg.transaction(async (tx) => {
                    for (const stmt of stmts) {
                        await tx.query(stmt.text, stmt.params ?? []);
                    }
                    throw new Error("injected crash");
                });
            },
        };
    }

    it("exposes the ordered pipeline plus terminals and pure legality", () => {
        expect(PUBLICATION_STATES).toEqual([
            "discovered",
            "acquired",
            "ocr_candidate",
            "assets_staged",
            "db_revision_staged",
            "validated",
            "active",
            "failed",
            "rolled_back",
        ]);
        // single forward steps
        expect(canTransition("discovered", "acquired")).toBe(true);
        expect(canTransition("db_revision_staged", "validated")).toBe(true);
        expect(canTransition("validated", "active")).toBe(true);
        // failure from any non-terminal state, including active
        expect(canTransition("discovered", "failed")).toBe(true);
        expect(canTransition("active", "failed")).toBe(true);
        // rollback only from active
        expect(canTransition("active", "rolled_back")).toBe(true);
        expect(canTransition("validated", "rolled_back")).toBe(false);
        // terminals never leave; same-state is not a transition; no skips/backs
        expect(canTransition("failed", "acquired")).toBe(false);
        expect(canTransition("rolled_back", "failed")).toBe(false);
        expect(canTransition("acquired", "acquired")).toBe(false);
        expect(canTransition("discovered", "ocr_candidate")).toBe(false);
        expect(canTransition("validated", "acquired")).toBe(false);
    });

    it("happy path: full pipeline to activation with an ordered event ledger", async () => {
        const { issueId, revisionId } = await seedIssue("1950-01-11");
        const runId = await createRun(db.executor, { issueId, metadata: { source: "test" } });

        const created = await getRun(db.executor, runId);
        expect(created?.state).toBe("discovered");
        expect(created?.issue_id).toBe(issueId);

        for (const next of [
            "acquired",
            "ocr_candidate",
            "assets_staged",
            "db_revision_staged",
            "validated",
        ] as const) {
            const run = await transitionRun(db.executor, runId, next);
            expect(run.state).toBe(next);
        }

        const activated = await activateRevision(db.executor, {
            issueId,
            editionRevisionId: revisionId,
            runId,
        });
        expect(activated.state).toBe("active");
        expect(await activePointer(issueId)).toBe(revisionId);

        expect(await runEvents(runId)).toEqual([
            { from_state: null, to_state: "discovered" },
            { from_state: "discovered", to_state: "acquired" },
            { from_state: "acquired", to_state: "ocr_candidate" },
            { from_state: "ocr_candidate", to_state: "assets_staged" },
            { from_state: "assets_staged", to_state: "db_revision_staged" },
            { from_state: "db_revision_staged", to_state: "validated" },
            { from_state: "validated", to_state: "active" },
        ]);
    });

    const ILLEGAL_CASES: ReadonlyArray<{
        from: PublicationState;
        to: PublicationState;
        walk: readonly PublicationState[];
    }> = [
        { from: "discovered", to: "assets_staged", walk: [] },
        { from: "acquired", to: "active", walk: ["acquired"] },
        {
            from: "validated",
            to: "acquired",
            walk: ["acquired", "ocr_candidate", "assets_staged", "db_revision_staged", "validated"],
        },
        { from: "failed", to: "acquired", walk: ["failed"] },
        { from: "failed", to: "active", walk: ["failed"] },
        { from: "failed", to: "rolled_back", walk: ["failed"] },
    ];

    it.each(ILLEGAL_CASES)(
        "rejects illegal jump $from -> $to without writing an event",
        async ({ from, to, walk }) => {
            const runId = await createRun(db.executor, {});
            for (const state of walk) {
                await transitionRun(db.executor, runId, state);
            }
            const eventsBefore = await runEvents(runId);

            const error = await transitionRun(db.executor, runId, to).catch((e: unknown) => e);
            expect(error).toBeInstanceOf(IllegalTransitionError);
            const illegal = error as IllegalTransitionError;
            expect(illegal.runId).toBe(runId);
            expect(illegal.from).toBe(from);
            expect(illegal.to).toBe(to);

            expect((await getRun(db.executor, runId))?.state).toBe(from);
            expect(await runEvents(runId)).toEqual(eventsBefore);
        },
    );

    it("crash/retry at every pipeline boundary is idempotent", async () => {
        const { issueId } = await seedIssue("1950-01-18");
        const runId = await createRun(db.executor, { issueId });

        for (let i = 0; i + 1 < PIPELINE_STATES.length; i += 1) {
            const from = PIPELINE_STATES[i];
            const to = PIPELINE_STATES[i + 1];
            const eventsBefore = await runEvents(runId);

            // Crash mid-batch: statements execute, transaction rolls back.
            await expect(transitionRun(crashingExecutor(), runId, to)).rejects.toThrow(
                "injected crash",
            );
            expect((await getRun(db.executor, runId))?.state).toBe(from);
            expect(await runEvents(runId)).toEqual(eventsBefore);

            // Retry with the real executor succeeds from the unchanged state.
            const run = await transitionRun(db.executor, runId, to);
            expect(run.state).toBe(to);
            const eventsAfter = await runEvents(runId);
            expect(eventsAfter).toHaveLength(eventsBefore.length + 1);
            expect(eventsAfter[eventsAfter.length - 1]).toEqual({
                from_state: from,
                to_state: to,
            });
        }
    });

    it("no partial activation: crashed activateRevision leaves pointer and run untouched", async () => {
        const { issueId, revisionId } = await seedIssue("1950-01-25");
        const runId = await createRun(db.executor, { issueId });
        await walkTo(runId, "validated");
        const eventsBefore = await runEvents(runId);

        await expect(
            activateRevision(crashingExecutor(), { issueId, editionRevisionId: revisionId, runId }),
        ).rejects.toThrow("injected crash");

        expect(await activePointer(issueId)).toBeNull();
        expect((await getRun(db.executor, runId))?.state).toBe("validated");
        expect(await runEvents(runId)).toEqual(eventsBefore);

        // The retry activates cleanly.
        await activateRevision(db.executor, { issueId, editionRevisionId: revisionId, runId });
        expect(await activePointer(issueId)).toBe(revisionId);
        expect((await getRun(db.executor, runId))?.state).toBe("active");
    });

    it("rollback repoints to the prior revision and keeps both revisions", async () => {
        const { issueId, revisionId: revA } = await seedIssue("1950-02-15");
        const runA = await createRun(db.executor, { issueId });
        await walkTo(runA, "validated");
        await activateRevision(db.executor, { issueId, editionRevisionId: revA, runId: runA });
        expect(await activePointer(issueId)).toBe(revA);

        const revB = ulid();
        await db.pg.query(
            `INSERT INTO edition_revisions (id, issue_id, revision_hash) VALUES ($1, $2, $3)`,
            [revB, issueId, `hash-${revB}`],
        );
        const runB = await createRun(db.executor, { issueId });
        await walkTo(runB, "validated");
        await activateRevision(db.executor, { issueId, editionRevisionId: revB, runId: runB });
        expect(await activePointer(issueId)).toBe(revB);

        const rolledBack = await rollbackActiveRevision(db.executor, {
            issueId,
            toRevisionId: revA,
            runId: runB,
            note: "regression in rev B",
        });
        expect(rolledBack.state).toBe("rolled_back");
        expect(await activePointer(issueId)).toBe(revA);

        const events = await runEvents(runB);
        expect(events[events.length - 1]).toEqual({
            from_state: "active",
            to_state: "rolled_back",
        });
        const { rows: noteRows } = await db.pg.query<{ note: string | null }>(
            `SELECT note FROM publication_run_events
             WHERE run_id = $1 AND to_state = 'rolled_back'`,
            [runB],
        );
        expect(noteRows).toEqual([{ note: "regression in rev B" }]);

        // Immutability: both revisions still exist after the rollback.
        const { rows: revisions } = await db.pg.query<{ id: string }>(
            `SELECT id FROM edition_revisions WHERE issue_id = $1 ORDER BY id`,
            [issueId],
        );
        expect(revisions.map((row) => row.id).sort()).toEqual([revA, revB].sort());
    });

    it("concurrent guard: a second transition from the same from-state throws and writes no event", async () => {
        // Sequential double-fire: the second call re-reads the advanced state.
        const runId = await createRun(db.executor, {});
        await transitionRun(db.executor, runId, "acquired");
        const eventsBefore = await runEvents(runId);

        await expect(transitionRun(db.executor, runId, "acquired")).rejects.toBeInstanceOf(
            IllegalTransitionError,
        );
        expect(await runEvents(runId)).toEqual(eventsBefore);
        expect((await getRun(db.executor, runId))?.state).toBe("acquired");

        // True race on the guarded UPDATE: this executor commits a competing
        // transition between our stale pre-read and our batch. The guarded
        // UPDATE then matches 0 rows, the CTE writes no event, and the
        // post-batch re-read throws IllegalTransitionError.
        const racedRunId = await createRun(db.executor, {});
        let raced = false;
        const racedExecutor: QueryExecutor = {
            query: (stmt: SqlStatement) => db.executor.query(stmt),
            async transactionBatch(stmts: SqlStatement[]): Promise<void> {
                if (!raced) {
                    raced = true;
                    await transitionRun(db.executor, racedRunId, "failed", {
                        failureReason: "concurrent failure",
                    });
                }
                await db.executor.transactionBatch(stmts);
            },
        };

        const error = await transitionRun(racedExecutor, racedRunId, "acquired").catch(
            (e: unknown) => e,
        );
        expect(error).toBeInstanceOf(IllegalTransitionError);
        expect((error as IllegalTransitionError).runId).toBe(racedRunId);
        expect((await getRun(db.executor, racedRunId))?.state).toBe("failed");
        expect(await runEvents(racedRunId)).toEqual([
            { from_state: null, to_state: "discovered" },
            { from_state: "discovered", to_state: "failed" },
        ]);
    });

    it("resumeRun derives the next action without writing", async () => {
        const runId = await createRun(db.executor, {});

        let plan = await resumeRun(db.executor, runId);
        expect(plan.run.state).toBe("discovered");
        expect(plan.nextAction.kind).toBe("advance");
        expect(plan.nextAction.revalidate).toBe("discovered");
        expect(plan.nextAction.nextState).toBe("acquired");

        await walkTo(runId, "validated");
        plan = await resumeRun(db.executor, runId);
        expect(plan.nextAction.kind).toBe("activate");
        expect(plan.nextAction.nextState).toBe("active");

        const eventsBefore = await runEvents(runId);
        await transitionRun(db.executor, runId, "failed", { failureReason: "validator crash" });
        plan = await resumeRun(db.executor, runId);
        expect(plan.nextAction.kind).toBe("terminal");
        expect(plan.nextAction.nextState).toBeNull();
        // resumeRun itself wrote nothing (only the explicit failure event landed).
        expect(await runEvents(runId)).toHaveLength(eventsBefore.length + 1);
    });
});
