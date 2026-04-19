/**
 * Tests for the pure askReducer. No DOM, no fetch, no storage — each
 * action should deterministically move state from one shape to another.
 */

import { describe, it, expect } from "vitest";
import {
    askReducer,
    INITIAL_STATE,
    type AskState,
    type Turn,
} from "@/features/ask-archive/hooks/askReducer";

const META = {
    retrievalTimeMs: 100,
    generationTimeMs: 200,
    totalTimeMs: 300,
    articlesSearched: 3,
    method: "hybrid" as const,
};

function makeTurn(overrides: Partial<Turn> = {}): Turn {
    return {
        id: "t-1",
        question: "Q",
        answer: "A",
        status: "done",
        sourceArticles: [],
        citations: [],
        meta: META,
        confidence: "high",
        requestId: "req-1",
        mode: "text",
        createdAt: 0,
        ...overrides,
    };
}

describe("askReducer", () => {
    it("HYDRATING sets isHydrating", () => {
        const next = askReducer(INITIAL_STATE, { type: "HYDRATING" });
        expect(next.isHydrating).toBe(true);
    });

    it("HYDRATE replaces turns and resets the hydrating flag", () => {
        const turns = [makeTurn()];
        const next = askReducer(
            { ...INITIAL_STATE, isHydrating: true },
            { type: "HYDRATE", turns, expired: false },
        );
        expect(next.isHydrating).toBe(false);
        expect(next.turns).toHaveLength(1);
        expect(next.expiredBanner).toBe(false);
    });

    it("HYDRATE with expired:true raises the banner", () => {
        const next = askReducer(INITIAL_STATE, {
            type: "HYDRATE",
            turns: [],
            expired: true,
        });
        expect(next.expiredBanner).toBe(true);
    });

    it("APPEND_USER adds a new streaming turn", () => {
        const next = askReducer(INITIAL_STATE, {
            type: "APPEND_USER",
            id: "t-new",
            question: "Hello?",
            createdAt: 42,
        });
        expect(next.turns).toHaveLength(1);
        expect(next.turns[0].id).toBe("t-new");
        expect(next.turns[0].question).toBe("Hello?");
        expect(next.turns[0].status).toBe("streaming");
        expect(next.turns[0].createdAt).toBe(42);
    });

    it("APPEND_USER freezes any still-streaming previous turn at 'done'", () => {
        const state: AskState = {
            ...INITIAL_STATE,
            turns: [
                makeTurn({
                    id: "t-prev",
                    status: "streaming",
                    answer: "partial",
                }),
            ],
        };
        const next = askReducer(state, {
            type: "APPEND_USER",
            id: "t-new",
            question: "follow-up",
        });
        expect(next.turns).toHaveLength(2);
        expect(next.turns[0].status).toBe("done");
        expect(next.turns[0].answer).toBe("partial");
        expect(next.turns[1].status).toBe("streaming");
    });

    it("APPEND_USER clears the expired banner", () => {
        const state: AskState = { ...INITIAL_STATE, expiredBanner: true };
        const next = askReducer(state, {
            type: "APPEND_USER",
            id: "t-1",
            question: "q",
        });
        expect(next.expiredBanner).toBe(false);
    });

    it("TURN_META fills mode/requestId/sourceArticles/meta", () => {
        const state: AskState = {
            ...INITIAL_STATE,
            turns: [
                makeTurn({ id: "t-1", status: "streaming", answer: "" }),
            ],
        };
        const next = askReducer(state, {
            type: "TURN_META",
            id: "t-1",
            mode: "text",
            requestId: "req-xyz",
            sourceArticles: [],
            meta: { retrievalTimeMs: 50 },
        });
        expect(next.turns[0].requestId).toBe("req-xyz");
        expect(next.turns[0].meta?.retrievalTimeMs).toBe(50);
    });

    it("TURN_STAGE updates the Thinking pill", () => {
        const state: AskState = {
            ...INITIAL_STATE,
            turns: [makeTurn({ id: "t-1", status: "streaming" })],
        };
        const next = askReducer(state, {
            type: "TURN_STAGE",
            id: "t-1",
            stage: "retrieve",
        });
        expect(next.turns[0].stage).toBe("retrieve");
    });

    it("TURN_DELTA appends to answer and clears the stage pill", () => {
        const state: AskState = {
            ...INITIAL_STATE,
            turns: [
                makeTurn({
                    id: "t-1",
                    status: "streaming",
                    answer: "Hello ",
                    stage: "generate",
                }),
            ],
        };
        const next = askReducer(state, {
            type: "TURN_DELTA",
            id: "t-1",
            text: "world.",
        });
        expect(next.turns[0].answer).toBe("Hello world.");
        expect(next.turns[0].stage).toBeUndefined();
    });

    it("TURN_DONE freezes the turn with final fields", () => {
        const state: AskState = {
            ...INITIAL_STATE,
            turns: [makeTurn({ id: "t-1", status: "streaming", answer: "" })],
        };
        const next = askReducer(state, {
            type: "TURN_DONE",
            id: "t-1",
            answer: "Final answer.",
            citations: [
                {
                    articleId: "1960-01-07-0",
                    headline: "H",
                    editionDate: "1960-01-07",
                },
            ],
            confidence: "high",
            meta: META,
            followUpQuestions: ["Tell me more?"],
        });
        expect(next.turns[0].status).toBe("done");
        expect(next.turns[0].answer).toBe("Final answer.");
        expect(next.turns[0].confidence).toBe("high");
        expect(next.turns[0].followUpQuestions).toEqual(["Tell me more?"]);
    });

    it("TURN_ERROR replaces the assistant region with a typed error", () => {
        const state: AskState = {
            ...INITIAL_STATE,
            turns: [makeTurn({ id: "t-1", status: "streaming" })],
        };
        const next = askReducer(state, {
            type: "TURN_ERROR",
            id: "t-1",
            kind: "rate_limit",
            message: "Too many requests",
            retryAfterSec: 42,
        });
        expect(next.turns[0].status).toBe("error");
        expect(next.turns[0].errorKind).toBe("rate_limit");
        expect(next.turns[0].errorMessage).toBe("Too many requests");
        expect(next.turns[0].retryAfterSec).toBe(42);
    });

    it("CLEAR_CONVERSATION empties turns, bumps sessionGen, marks emptyReason='cleared'", () => {
        const state: AskState = {
            ...INITIAL_STATE,
            turns: [makeTurn()],
            expiredBanner: true,
        };
        const next = askReducer(state, { type: "CLEAR_CONVERSATION" });
        expect(next.turns).toEqual([]);
        expect(next.expiredBanner).toBe(false);
        expect(next.sessionGen).toBe(INITIAL_STATE.sessionGen + 1);
        expect(next.emptyReason).toBe("cleared");
    });

    it("NEW_CONVERSATION empties turns, bumps sessionGen, marks emptyReason='new'", () => {
        const state: AskState = {
            ...INITIAL_STATE,
            turns: [makeTurn()],
            expiredBanner: true,
            sessionGen: 3,
        };
        const next = askReducer(state, { type: "NEW_CONVERSATION" });
        expect(next.turns).toEqual([]);
        expect(next.expiredBanner).toBe(false);
        // sessionGen keeps incrementing so the sidebar stays mounted —
        // we do NOT reset to 0 (which would trigger the page-level
        // editorial landing takeover).
        expect(next.sessionGen).toBe(4);
        expect(next.emptyReason).toBe("new");
    });

    it("APPEND_USER clears a prior emptyReason so the Transcript renders turns, not the empty state", () => {
        const state: AskState = {
            ...INITIAL_STATE,
            emptyReason: "new",
            sessionGen: 2,
        };
        const next = askReducer(state, {
            type: "APPEND_USER",
            id: "t-1",
            question: "hello?",
            createdAt: 0,
        });
        expect(next.turns).toHaveLength(1);
        expect(next.emptyReason).toBeNull();
    });

    it("SET_THREADS replaces threads summary + activeThreadId", () => {
        const next = askReducer(INITIAL_STATE, {
            type: "SET_THREADS",
            threads: [
                {
                    id: "t-a",
                    firstQuestion: "old q",
                    turnCount: 3,
                    lastUpdatedAt: 1,
                },
            ],
            activeThreadId: "t-a",
        });
        expect(next.threads).toHaveLength(1);
        expect(next.threads[0].id).toBe("t-a");
        expect(next.activeThreadId).toBe("t-a");
    });

    it("SWITCH_THREAD replaces turns + activeThreadId and bumps sessionGen", () => {
        const archived = [makeTurn({ id: "arch-1", question: "old one" })];
        const next = askReducer(
            {
                ...INITIAL_STATE,
                turns: [makeTurn({ id: "cur-1" })],
                sessionGen: 2,
                emptyReason: null,
            },
            {
                type: "SWITCH_THREAD",
                activeThreadId: "arch-session",
                turns: archived,
            },
        );
        expect(next.turns).toEqual(archived);
        expect(next.activeThreadId).toBe("arch-session");
        expect(next.sessionGen).toBe(3); // bumped
        expect(next.isHydrating).toBe(false);
        expect(next.expiredBanner).toBe(false);
        expect(next.emptyReason).toBeNull();
    });

    it("HYDRATE merges threads + activeThreadId when provided", () => {
        const next = askReducer(INITIAL_STATE, {
            type: "HYDRATE",
            turns: [],
            expired: false,
            threads: [
                {
                    id: "t-arch",
                    firstQuestion: "archived q",
                    turnCount: 2,
                    lastUpdatedAt: 10,
                },
            ],
            activeThreadId: "t-arch",
        });
        expect(next.threads).toHaveLength(1);
        expect(next.threads[0].id).toBe("t-arch");
        expect(next.activeThreadId).toBe("t-arch");
    });

    it("HYDRATE without threads/activeThreadId preserves prior values", () => {
        const prior: AskState = {
            ...INITIAL_STATE,
            threads: [
                {
                    id: "keep",
                    firstQuestion: "keep me",
                    turnCount: 1,
                    lastUpdatedAt: 0,
                },
            ],
            activeThreadId: "keep",
        };
        const next = askReducer(prior, {
            type: "HYDRATE",
            turns: [],
            expired: false,
        });
        expect(next.threads).toEqual(prior.threads);
        expect(next.activeThreadId).toBe("keep");
    });

    it("unknown turn ids are no-ops (state unchanged)", () => {
        const state: AskState = {
            ...INITIAL_STATE,
            turns: [makeTurn({ id: "t-1" })],
        };
        const next = askReducer(state, {
            type: "TURN_DELTA",
            id: "t-UNKNOWN",
            text: "ignored",
        });
        expect(next).toBe(state);
    });
});
