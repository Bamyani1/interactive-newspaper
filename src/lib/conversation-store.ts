/**
 * Conversation Store
 *
 * In-memory session store for multi-turn RAG conversations. Each session
 * holds the last N turns (question + answer summary + cited article IDs)
 * so the reformulator can resolve follow-up references like "tell me more
 * about that" or "what happened next?"
 *
 * Sessions expire after TTL_MS of inactivity. Total session count is
 * capped with LRU eviction to bound memory usage.
 */

const MAX_TURNS = 5;
const TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_SESSIONS = 100;
const ANSWER_TRUNCATE_CHARS = 500;

export interface ConversationTurn {
    question: string;
    answer: string;
    citedArticleIds: string[];
    timestamp: number;
}

interface Session {
    turns: ConversationTurn[];
    lastAccess: number;
}

const sessions = new Map<string, Session>();

function evictExpired(): void {
    const now = Date.now();
    for (const [id, session] of sessions) {
        if (now - session.lastAccess > TTL_MS) {
            sessions.delete(id);
        }
    }
}

function evictLRU(): void {
    if (sessions.size <= MAX_SESSIONS) return;
    let oldestId: string | null = null;
    let oldestTime = Infinity;
    for (const [id, session] of sessions) {
        if (session.lastAccess < oldestTime) {
            oldestTime = session.lastAccess;
            oldestId = id;
        }
    }
    if (oldestId) sessions.delete(oldestId);
}

export function newSessionId(): string {
    return Math.random().toString(36).slice(2, 10) +
        Date.now().toString(36);
}

export function getConversationHistory(sessionId: string): ConversationTurn[] {
    evictExpired();
    const session = sessions.get(sessionId);
    if (!session) return [];
    session.lastAccess = Date.now();
    return [...session.turns];
}

export function addConversationTurn(
    sessionId: string,
    question: string,
    answer: string,
    citedArticleIds: string[],
): void {
    evictExpired();
    let session = sessions.get(sessionId);
    if (!session) {
        evictLRU();
        session = { turns: [], lastAccess: Date.now() };
        sessions.set(sessionId, session);
    }

    session.lastAccess = Date.now();
    session.turns.push({
        question,
        answer: answer.slice(0, ANSWER_TRUNCATE_CHARS),
        citedArticleIds,
        timestamp: Date.now(),
    });

    if (session.turns.length > MAX_TURNS) {
        session.turns = session.turns.slice(-MAX_TURNS);
    }
}

export function formatHistoryForPrompt(turns: ConversationTurn[]): string {
    if (turns.length === 0) return "";
    return turns
        .map((t, i) => `[Turn ${i + 1}] Q: ${t.question}\nA: ${t.answer}`)
        .join("\n\n");
}

export function _clearSessionsForTests(): void {
    sessions.clear();
}
