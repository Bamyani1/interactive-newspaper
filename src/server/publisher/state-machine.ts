import type { QueryExecutor, SqlStatement } from "../../../scripts/db/lib/migration-runner";
import { ulid } from "../identity/ulid";

/**
 * Publication state machine over the Phase 3 tables (publication_runs,
 * publication_run_events, issues.active_edition_revision_id).
 *
 * Executor-injectable: every function takes a QueryExecutor, so the same code
 * runs against Neon in production and PGlite in tests. This module never
 * imports a database driver.
 *
 * Guard mechanism (used by transitionRun / activateRevision /
 * rollbackActiveRevision): transactionBatch cannot report affected-row counts
 * and cannot branch mid-batch, so each state write is a single data-modifying
 * CTE statement in which the publication_run_events INSERT selects FROM the
 * guarded UPDATE's RETURNING set. The event row is therefore written if and
 * only if the guarded UPDATE (WHERE id = $run AND state = $expectedFrom)
 * actually moved the run row, inside the same transaction. After the batch the
 * run is re-read: if its state is not the target state, a concurrent writer or
 * a crashed-resume operating on a stale read won the race — the CTE wrote
 * nothing (no event, no pointer move) and IllegalTransitionError is thrown.
 * The one interleaving this post-check cannot flag is a concurrent transition
 * to the SAME target state: the loser's CTE still writes nothing (so no
 * duplicate event and no double pointer write) and the re-read shows the
 * target state, so the loser returns as if it had won — the ledger and run row
 * remain consistent either way.
 */

/** Ordered forward pipeline. A run advances exactly one step at a time. */
export const PIPELINE_STATES = [
    "discovered",
    "acquired",
    "ocr_candidate",
    "assets_staged",
    "db_revision_staged",
    "validated",
    "active",
] as const;

/** States a run can never leave. */
export const TERMINAL_STATES = ["failed", "rolled_back"] as const;

/** Every publication run state: the pipeline in order, then the terminals. */
export const PUBLICATION_STATES = [...PIPELINE_STATES, ...TERMINAL_STATES] as const;

export type PipelineState = (typeof PIPELINE_STATES)[number];
export type TerminalState = (typeof TERMINAL_STATES)[number];
export type PublicationState = (typeof PUBLICATION_STATES)[number];

/**
 * Pure transition legality:
 * - exactly one forward step along the pipeline;
 * - any non-terminal state may move to 'failed';
 * - 'active' may move to 'rolled_back';
 * - re-entering the SAME state is not a transition (callers re-validate the
 *   current state's work instead of re-recording it);
 * - everything else is illegal.
 */
export function canTransition(from: PublicationState, to: PublicationState): boolean {
    if (from === to) return false;
    if ((TERMINAL_STATES as readonly string[]).includes(from)) return false;
    if (to === "failed") return true;
    if (to === "rolled_back") return from === "active";
    const fromIndex = PIPELINE_STATES.indexOf(from as PipelineState);
    const toIndex = PIPELINE_STATES.indexOf(to as PipelineState);
    return fromIndex >= 0 && toIndex === fromIndex + 1;
}

export class IllegalTransitionError extends Error {
    readonly runId: string;
    readonly from: PublicationState;
    readonly to: PublicationState;

    constructor(runId: string, from: PublicationState, to: PublicationState) {
        super(`Illegal publication run transition "${from}" -> "${to}" (run ${runId})`);
        this.name = "IllegalTransitionError";
        this.runId = runId;
        this.from = from;
        this.to = to;
    }
}

export interface PublicationRunRow {
    id: string;
    issue_id: string | null;
    state: PublicationState;
    started_at: Date | string;
    updated_at: Date | string;
    failure_reason: string | null;
    metadata: Record<string, unknown>;
}

const RUN_COLUMNS = "id, issue_id, state, started_at, updated_at, failure_reason, metadata";

/**
 * Creates a publication run in 'discovered' plus its birth event
 * (from_state NULL) in one transaction. Returns the new run id (ULID).
 */
export async function createRun(
    executor: QueryExecutor,
    options: { issueId?: string; metadata?: Record<string, unknown> } = {},
): Promise<string> {
    const runId = ulid();
    await executor.transactionBatch([
        {
            text: `INSERT INTO publication_runs (id, issue_id, state, metadata)
                   VALUES ($1, $2, 'discovered', $3::jsonb)`,
            params: [runId, options.issueId ?? null, JSON.stringify(options.metadata ?? {})],
        },
        {
            text: `INSERT INTO publication_run_events (run_id, from_state, to_state)
                   VALUES ($1, NULL, 'discovered')`,
            params: [runId],
        },
    ]);
    return runId;
}

export async function getRun(
    executor: QueryExecutor,
    runId: string,
): Promise<PublicationRunRow | null> {
    const rows = await executor.query({
        text: `SELECT ${RUN_COLUMNS} FROM publication_runs WHERE id = $1`,
        params: [runId],
    });
    return rows.length > 0 ? (rows[0] as unknown as PublicationRunRow) : null;
}

/**
 * Moves a run one legal step. Reads the current state, validates with
 * canTransition, then commits the guarded UPDATE + event INSERT as one CTE
 * statement (see the module-level guard note), and finally re-reads the run:
 * if the observed state is not `toState` the guarded UPDATE matched zero rows
 * (concurrent transition or stale resume) and IllegalTransitionError is
 * thrown — in that case no event row was written.
 */
export async function transitionRun(
    executor: QueryExecutor,
    runId: string,
    toState: PublicationState,
    options: { note?: string; failureReason?: string } = {},
): Promise<PublicationRunRow> {
    const current = await getRun(executor, runId);
    if (!current) {
        throw new Error(`Publication run ${runId} not found`);
    }
    const fromState = current.state;
    if (!canTransition(fromState, toState)) {
        throw new IllegalTransitionError(runId, fromState, toState);
    }

    await executor.transactionBatch([
        {
            text: `WITH moved AS (
                       UPDATE publication_runs
                       SET state = $2, updated_at = now(), failure_reason = $3
                       WHERE id = $1 AND state = $4
                       RETURNING id
                   )
                   INSERT INTO publication_run_events (run_id, from_state, to_state, note)
                   SELECT id, $4, $2, $5 FROM moved`,
            params: [runId, toState, options.failureReason ?? null, fromState, options.note ?? null],
        },
    ]);

    const after = await getRun(executor, runId);
    if (!after || after.state !== toState) {
        throw new IllegalTransitionError(runId, after?.state ?? fromState, toState);
    }
    return after;
}

/**
 * THE atomic activation: flips issues.active_edition_revision_id and moves the
 * run 'validated' -> 'active' in a single statement inside one transaction.
 * The CTE chain makes all three writes mutually dependent — the pointer UPDATE
 * requires the run to be in 'validated' (same snapshot), the run UPDATE
 * requires the pointer UPDATE to have hit the issue row, and the event INSERT
 * selects from the run UPDATE — so either all three apply or none do. After
 * the batch both rows are re-read and asserted.
 */
export async function activateRevision(
    executor: QueryExecutor,
    args: { issueId: string; editionRevisionId: string; runId: string },
): Promise<PublicationRunRow> {
    const { issueId, editionRevisionId, runId } = args;
    const current = await getRun(executor, runId);
    if (!current) {
        throw new Error(`Publication run ${runId} not found`);
    }
    if (current.state !== "validated") {
        throw new IllegalTransitionError(runId, current.state, "active");
    }

    await executor.transactionBatch([
        {
            text: `WITH eligible AS (
                       SELECT 1 FROM publication_runs WHERE id = $1 AND state = 'validated'
                   ),
                   pointed AS (
                       UPDATE issues
                       SET active_edition_revision_id = $2
                       WHERE id = $3 AND EXISTS (SELECT 1 FROM eligible)
                       RETURNING id
                   ),
                   moved AS (
                       UPDATE publication_runs
                       SET state = 'active', updated_at = now()
                       WHERE id = $1 AND state = 'validated'
                         AND EXISTS (SELECT 1 FROM pointed)
                       RETURNING id
                   )
                   INSERT INTO publication_run_events (run_id, from_state, to_state)
                   SELECT id, 'validated', 'active' FROM moved`,
            params: [runId, editionRevisionId, issueId],
        },
    ]);

    const after = await getRun(executor, runId);
    if (!after || after.state !== "active") {
        // Guarded UPDATE matched zero rows: the transaction wrote nothing
        // (no pointer move, no event) — activation did not happen.
        throw new IllegalTransitionError(runId, after?.state ?? "validated", "active");
    }
    const issueRows = await executor.query({
        text: `SELECT active_edition_revision_id FROM issues WHERE id = $1`,
        params: [issueId],
    });
    if (issueRows.length === 0 || issueRows[0].active_edition_revision_id !== editionRevisionId) {
        throw new Error(
            `Activation postcondition failed for issue ${issueId}: ` +
                `active_edition_revision_id is not ${editionRevisionId}`,
        );
    }
    return after;
}

/**
 * Atomic rollback: repoints issues.active_edition_revision_id to a prior
 * revision and moves the run 'active' -> 'rolled_back', with the event, in one
 * CTE statement — the same all-or-nothing chain as activateRevision.
 */
export async function rollbackActiveRevision(
    executor: QueryExecutor,
    args: { issueId: string; toRevisionId: string; runId: string; note?: string },
): Promise<PublicationRunRow> {
    const { issueId, toRevisionId, runId } = args;
    const current = await getRun(executor, runId);
    if (!current) {
        throw new Error(`Publication run ${runId} not found`);
    }
    if (current.state !== "active") {
        throw new IllegalTransitionError(runId, current.state, "rolled_back");
    }

    await executor.transactionBatch([
        {
            text: `WITH eligible AS (
                       SELECT 1 FROM publication_runs WHERE id = $1 AND state = 'active'
                   ),
                   pointed AS (
                       UPDATE issues
                       SET active_edition_revision_id = $2
                       WHERE id = $3 AND EXISTS (SELECT 1 FROM eligible)
                       RETURNING id
                   ),
                   moved AS (
                       UPDATE publication_runs
                       SET state = 'rolled_back', updated_at = now()
                       WHERE id = $1 AND state = 'active'
                         AND EXISTS (SELECT 1 FROM pointed)
                       RETURNING id
                   )
                   INSERT INTO publication_run_events (run_id, from_state, to_state, note)
                   SELECT id, 'active', 'rolled_back', $4 FROM moved`,
            params: [runId, toRevisionId, issueId, args.note ?? null],
        },
    ]);

    const after = await getRun(executor, runId);
    if (!after || after.state !== "rolled_back") {
        throw new IllegalTransitionError(runId, after?.state ?? "active", "rolled_back");
    }
    const issueRows = await executor.query({
        text: `SELECT active_edition_revision_id FROM issues WHERE id = $1`,
        params: [issueId],
    });
    if (issueRows.length === 0 || issueRows[0].active_edition_revision_id !== toRevisionId) {
        throw new Error(
            `Rollback postcondition failed for issue ${issueId}: ` +
                `active_edition_revision_id is not ${toRevisionId}`,
        );
    }
    return after;
}

export interface ResumeAction {
    /**
     * advance: re-validate the current state's outputs, then transitionRun to
     * nextState. activate: re-run validation, then call activateRevision.
     * complete: the run is active; nothing to do. terminal: the run ended
     * ('failed' / 'rolled_back'); start a new run instead.
     */
    kind: "advance" | "activate" | "complete" | "terminal";
    /** State whose work the driver must re-verify before proceeding. */
    revalidate: PublicationState;
    /** Target of the next transition, or null when there is none. */
    nextState: PublicationState | null;
    description: string;
}

const RESUME_ACTIONS: Record<PublicationState, Omit<ResumeAction, "revalidate">> = {
    discovered: {
        kind: "advance",
        nextState: "acquired",
        description:
            "Re-verify the discovery source record, re-acquire raw source assets if missing, then transition to 'acquired'.",
    },
    acquired: {
        kind: "advance",
        nextState: "ocr_candidate",
        description:
            "Re-verify the acquired assets are complete, then mark the run as an OCR candidate ('ocr_candidate').",
    },
    ocr_candidate: {
        kind: "advance",
        nextState: "assets_staged",
        description:
            "Re-check OCR outputs for this candidate, re-stage assets idempotently, then transition to 'assets_staged'.",
    },
    assets_staged: {
        kind: "advance",
        nextState: "db_revision_staged",
        description:
            "Re-verify staged assets by hash, re-stage the edition/content revisions idempotently, then transition to 'db_revision_staged'.",
    },
    db_revision_staged: {
        kind: "advance",
        nextState: "validated",
        description:
            "Re-run validation over the staged revision (page counts, identity, references), then transition to 'validated'.",
    },
    validated: {
        kind: "activate",
        nextState: "active",
        description:
            "Re-confirm validation still holds, then call activateRevision to flip the issue pointer atomically.",
    },
    active: {
        kind: "complete",
        nextState: null,
        description: "Run is complete; the revision is live. Nothing to resume.",
    },
    failed: {
        kind: "terminal",
        nextState: null,
        description: "Run failed terminally. Inspect failure_reason and start a new run.",
    },
    rolled_back: {
        kind: "terminal",
        nextState: null,
        description: "Run was rolled back. Start a new run to publish a corrected revision.",
    },
};

/**
 * Pure read: derives what a driver should do next for the run's CURRENT state
 * (always: re-validate that state's work, then perform the single next step).
 * Performs no writes.
 */
export async function resumeRun(
    executor: QueryExecutor,
    runId: string,
): Promise<{ run: PublicationRunRow; nextAction: ResumeAction }> {
    const run = await getRun(executor, runId);
    if (!run) {
        throw new Error(`Publication run ${runId} not found`);
    }
    const base = RESUME_ACTIONS[run.state];
    return { run, nextAction: { ...base, revalidate: run.state } };
}

export type { QueryExecutor, SqlStatement };
