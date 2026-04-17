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
    timestamp: number;
}

let _sql: ReturnType<typeof neon> | null = null;
function getSql(): ReturnType<typeof neon> | null {
    if (_sql !== null) return _sql;
    const url = process.env.DATABASE_URL;
    if (!url) return null;
    _sql = neon(url);
    return _sql;
}

export function newSessionId(): string {
    // Keep the old short-id format for log greppability; uuid would also
    // work but existing log tooling expects the compact form.
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export async function getConversationHistory(
    sessionId: string,
): Promise<ConversationTurn[]> {
    const sql = getSql();
    if (!sql) return [];
    const sinceIso = new Date(Date.now() - TTL_MS).toISOString();
    try {
        const rows = (await sql`
            SELECT question, answer, cited_article_ids, created_at
            FROM ask_session_turns
            WHERE session_id = ${sessionId}
              AND created_at >= ${sinceIso}
            ORDER BY created_at DESC
            LIMIT ${MAX_TURNS}
        `) as Array<{
            question: string;
            answer: string;
            cited_article_ids: string[] | null;
            created_at: string | Date;
        }>;
        // DB returns most-recent-first; reverse so callers see
        // chronological order like the old in-memory Map did.
        return rows.reverse().map((r) => ({
            question: r.question,
            answer: r.answer,
            citedArticleIds: r.cited_article_ids ?? [],
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
): Promise<void> {
    const sql = getSql();
    if (!sql) return;
    const stored =
        answer.length > ANSWER_TRUNCATE_CHARS
            ? answer.slice(
                  0,
                  ANSWER_TRUNCATE_CHARS - TRUNCATION_MARKER.length,
              ) + TRUNCATION_MARKER
            : answer;
    try {
        await sql`
            INSERT INTO ask_session_turns
              (session_id, question, answer, cited_article_ids)
            VALUES
              (${sessionId}, ${question}, ${stored}, ${citedArticleIds})
        `;
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

export function formatHistoryForPrompt(turns: ConversationTurn[]): string {
    if (turns.length === 0) return "";
    return turns
        .map((t, i) => `[Turn ${i + 1}] Q: ${t.question}\nA: ${t.answer}`)
        .join("\n\n");
}

// Test hook — no-op now that state lives in Neon, but kept to preserve
// call-site compatibility with tests that import it.
export function _clearSessionsForTests(): void {
    // intentional no-op
}
