/**
 * Conversation Store — Neon-backed
 *
 * Stores the last N turns (question + short answer snippet + cited
 * article IDs) for each session in a Neon `ask_session_turns` table
 * so conversation context survives Vercel cold starts and works
 * across function instances. The prior in-memory Map implementation
 * silently lost state on rotation.
 *
 * All DB-touching helpers are graceful: if Neon is unreachable or
 * DATABASE_URL is unset (tests), they log a warning and return the
 * no-history path. That way conversation history degrades quietly
 * to zero rather than failing the user's request.
 */

import { neon } from "@neondatabase/serverless";
import { isRagEvaluationMode } from "@/src/lib/rag-evaluation";
import type { CitationSnapshot } from "@/src/types";
import { isCitationSnapshot } from "@/src/lib/citation-snapshot";

const MAX_TURNS = 5;
const TTL_MS = 30 * 60 * 1000; // 30 minutes
// Store the full answer so follow-ups see real context. Cap at 8000 chars
// with a marker so a runaway answer can't bloat history past the prompt
// budget; typical answers are well under this.
const ANSWER_TRUNCATE_CHARS = 8000;
const TRUNCATION_MARKER = "\n[…truncated]";

export interface ConversationTurn {
    question: string;
    answer: string;
    citedArticleIds: string[];
    citationSnapshots: CitationSnapshot[];
    timestamp: number;
}

// Live evaluations need multi-turn behavior without persisting user-like test
// content. The store is process-local, TTL-bound, and cleared between runs.
const evaluationSessions = new Map<string, ConversationTurn[]>();

function liveEvaluationTurns(sessionId: string): ConversationTurn[] {
    const cutoff = Date.now() - TTL_MS;
    const turns = (evaluationSessions.get(sessionId) ?? []).filter(
        (turn) => turn.timestamp >= cutoff,
    );
    if (turns.length === 0) evaluationSessions.delete(sessionId);
    else evaluationSessions.set(sessionId, turns);
    return turns;
}

let _sql: ReturnType<typeof neon> | null = null;
let citationSnapshotColumn: { value: boolean; checkedAt: number } | null = null;
const SCHEMA_PROBE_TTL_MS = 30_000;
function getSql(): ReturnType<typeof neon> | null {
    if (_sql !== null) return _sql;
    const url = process.env.DATABASE_URL;
    if (!url) return null;
    _sql = neon(url);
    return _sql;
}

async function hasCitationSnapshotColumn(
    sql: ReturnType<typeof neon>,
): Promise<boolean> {
    if (
        citationSnapshotColumn &&
        Date.now() - citationSnapshotColumn.checkedAt < SCHEMA_PROBE_TTL_MS
    ) {
        return citationSnapshotColumn.value;
    }
    try {
        const rows = (await sql`
            SELECT EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'ask_session_turns'
                  AND column_name = 'citation_snapshots'
            ) AS exists
        `) as Array<{ exists: boolean }>;
        const value = Boolean(rows[0]?.exists);
        citationSnapshotColumn = { value, checkedAt: Date.now() };
        return value;
    } catch {
        // A probe failure must not drop an otherwise valid conversation turn.
        // Fall back to the legacy insert and retry the probe after the TTL.
        citationSnapshotColumn = { value: false, checkedAt: Date.now() };
        return false;
    }
}

export function newSessionId(): string {
    // Keep the old short-id format for log greppability; uuid would also
    // work but existing log tooling expects the compact form.
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export async function getConversationHistory(
    sessionId: string,
): Promise<ConversationTurn[]> {
    if (isRagEvaluationMode()) {
        return liveEvaluationTurns(sessionId).slice(-MAX_TURNS);
    }
    const sql = getSql();
    if (!sql) return [];
    const sinceIso = new Date(Date.now() - TTL_MS).toISOString();
    try {
        const rows = (await sql`
            SELECT question, answer, cited_article_ids,
                   COALESCE(
                     to_jsonb(ask_session_turns)->'citation_snapshots',
                     '[]'::jsonb
                   ) AS citation_snapshots,
                   created_at
            FROM ask_session_turns
            WHERE session_id = ${sessionId}
              AND created_at >= ${sinceIso}
            ORDER BY created_at DESC
            LIMIT ${MAX_TURNS}
        `) as Array<{
            question: string;
            answer: string;
            cited_article_ids: string[] | null;
            citation_snapshots: unknown;
            created_at: string | Date;
        }>;
        // DB returns most-recent-first; reverse so callers see
        // chronological order like the old in-memory Map did.
        return rows.reverse().map((r) => ({
            question: r.question,
            answer: r.answer,
            citedArticleIds: r.cited_article_ids ?? [],
            citationSnapshots: Array.isArray(r.citation_snapshots)
                ? r.citation_snapshots.filter(isCitationSnapshot)
                : [],
            timestamp:
                r.created_at instanceof Date
                    ? r.created_at.getTime()
                    : new Date(String(r.created_at)).getTime(),
        }));
    } catch (err) {
        console.warn(
            JSON.stringify({
                level: "warn",
                module: "conversation-store",
                op: "getConversationHistory",
                msg: "db read failed; returning empty history",
                err: err instanceof Error ? err.message : String(err),
            }),
        );
        return [];
    }
}

export async function addConversationTurn(
    sessionId: string,
    question: string,
    answer: string,
    citedArticleIds: string[],
    citationSnapshots: CitationSnapshot[] = [],
): Promise<void> {
    const stored =
        answer.length > ANSWER_TRUNCATE_CHARS
            ? answer.slice(
                  0,
                  ANSWER_TRUNCATE_CHARS - TRUNCATION_MARKER.length,
              ) + TRUNCATION_MARKER
            : answer;
    if (isRagEvaluationMode()) {
        const turns = liveEvaluationTurns(sessionId);
        turns.push({
            question,
            answer: stored,
            citedArticleIds: [...citedArticleIds],
            citationSnapshots: citationSnapshots.map((snapshot) => ({ ...snapshot })),
            timestamp: Date.now(),
        });
        evaluationSessions.set(sessionId, turns.slice(-MAX_TURNS));
        return;
    }
    const sql = getSql();
    if (!sql) return;
    const cutoffIso = new Date(Date.now() - TTL_MS).toISOString();
    try {
        const snapshotColumnAvailable = await hasCitationSnapshotColumn(sql);
        const insert = snapshotColumnAvailable
            ? sql`
                INSERT INTO ask_session_turns
                  (session_id, question, answer, cited_article_ids, citation_snapshots)
                VALUES
                  (${sessionId}, ${question}, ${stored}, ${citedArticleIds}, ${JSON.stringify(citationSnapshots)}::jsonb)
            `
            : sql`
                INSERT INTO ask_session_turns
                  (session_id, question, answer, cited_article_ids)
                VALUES
                  (${sessionId}, ${question}, ${stored}, ${citedArticleIds})
            `;
        await sql.transaction([
            insert,
            sql`DELETE FROM ask_session_turns WHERE created_at < ${cutoffIso}`,
            sql`
                DELETE FROM ask_session_turns
                WHERE session_id = ${sessionId}
                  AND id NOT IN (
                    SELECT id FROM ask_session_turns
                    WHERE session_id = ${sessionId}
                    ORDER BY created_at DESC
                    LIMIT ${MAX_TURNS}
                  )
            `,
        ]);
    } catch (err) {
        console.warn(
            JSON.stringify({
                level: "warn",
                module: "conversation-store",
                op: "addConversationTurn",
                msg: "db write failed; turn dropped",
                err: err instanceof Error ? err.message : String(err),
            }),
        );
    }
}

/**
 * Wipes every stored turn for a session. Used by the "Clear
 * conversation" button so the server doesn't keep the transcript
 * around until its 30-minute TTL. Best-effort: a DB failure only
 * means the old rows linger and age out naturally.
 */
export async function deleteConversationTurns(
    sessionId: string,
): Promise<void> {
    if (isRagEvaluationMode()) {
        evaluationSessions.delete(sessionId);
        return;
    }
    const sql = getSql();
    if (!sql) return;
    try {
        await sql`
            DELETE FROM ask_session_turns
            WHERE session_id = ${sessionId}
        `;
    } catch (err) {
        console.warn(
            JSON.stringify({
                level: "warn",
                module: "conversation-store",
                op: "deleteConversationTurns",
                msg: "db delete failed; session will age out via TTL",
                err: err instanceof Error ? err.message : String(err),
            }),
        );
    }
}

/**
 * Returns true if any row exists for this session regardless of TTL.
 * Used by the hydration endpoint to distinguish "never existed" from
 * "aged out" so the UI can show a gentle 'your last conversation
 * expired' banner instead of a silent empty state.
 */
export async function sessionHasAnyTurns(sessionId: string): Promise<boolean> {
    if (isRagEvaluationMode()) {
        return liveEvaluationTurns(sessionId).length > 0;
    }
    const sql = getSql();
    if (!sql) return false;
    try {
        const rows = (await sql`
            SELECT 1
            FROM ask_session_turns
            WHERE session_id = ${sessionId}
            LIMIT 1
        `) as Array<Record<string, unknown>>;
        return rows.length > 0;
    } catch (err) {
        console.warn(
            JSON.stringify({
                level: "warn",
                module: "conversation-store",
                op: "sessionHasAnyTurns",
                msg: "db probe failed; assuming no turns",
                err: err instanceof Error ? err.message : String(err),
            }),
        );
        return false;
    }
}

export function formatHistoryForPrompt(turns: ConversationTurn[]): string {
    if (turns.length === 0) return "";
    return turns
        .map((t, i) => `[Turn ${i + 1}] Q: ${t.question}\nA: ${t.answer}`)
        .join("\n\n");
}

export function _clearSessionsForTests(): void {
    evaluationSessions.clear();
    citationSnapshotColumn = null;
}
