"use client";

import React, { useEffect, useState } from "react";

interface ConversationTurn {
    question: string;
    answerSnippet: string;
    citedArticleIds: string[];
    timestamp: number;
}

interface ConversationHistoryProps {
    /**
     * Called when a user clicks a history item. The page-level handler
     * should populate the input with the question text (and focus the
     * input) — it must NOT auto-submit. History items are breadcrumbs
     * for re-asking, not shortcut submits.
     */
    onPickQuestion: (question: string) => void;
    disabled?: boolean;
    /**
     * Optional trigger so callers can force a refetch after a new
     * question is answered. Change the key (e.g. last answer id) to
     * re-pull from /api/ask/session.
     */
    refreshKey?: string | number;
    /**
     * Increments whenever the parent calls `newConversation()` on the
     * useAskArchive hook. Used to clear the visible history list
     * immediately on reset, even before the next refetch completes.
     */
    sessionGen?: number;
}

const SESSION_STORAGE_KEY = "owu-ask-session-id";

export const ConversationHistory: React.FC<ConversationHistoryProps> = ({
    onPickQuestion,
    disabled,
    refreshKey,
    sessionGen,
}) => {
    const [turns, setTurns] = useState<ConversationTurn[]>([]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        let sessionId: string | null = null;
        try {
            sessionId = window.localStorage.getItem(SESSION_STORAGE_KEY);
        } catch {
            // localStorage unavailable — no history to show
            setTurns([]);
            return;
        }
        // No session id (e.g. right after "New conversation") → clear
        // any stale turns immediately instead of keeping the old list.
        if (!sessionId) {
            setTurns([]);
            return;
        }

        let cancelled = false;
        (async () => {
            try {
                const res = await fetch(
                    `/api/ask/session?sessionId=${encodeURIComponent(sessionId)}`,
                );
                if (!res.ok) return;
                const json = (await res.json()) as { turns?: ConversationTurn[] };
                if (!cancelled && Array.isArray(json.turns)) {
                    setTurns(json.turns);
                }
            } catch {
                // Silent — history is a bonus, not load-bearing.
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [refreshKey, sessionGen]);

    if (turns.length === 0) return null;

    return (
        <aside className="ask-history" aria-label="Previous questions in this conversation">
            <p className="ask-history-label">In this conversation</p>
            <ul className="ask-history-list">
                {turns.map((turn, i) => (
                    <li key={`${turn.timestamp}-${i}`}>
                        <button
                            type="button"
                            className="ask-history-item"
                            onClick={() => onPickQuestion(turn.question)}
                            disabled={disabled}
                            title="Click to reuse this question in the input"
                        >
                            {turn.question}
                        </button>
                    </li>
                ))}
            </ul>
        </aside>
    );
};
