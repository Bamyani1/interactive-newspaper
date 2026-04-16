import { describe, it, expect, beforeEach } from "vitest";
import {
    getConversationHistory,
    addConversationTurn,
    newSessionId,
    formatHistoryForPrompt,
    _clearSessionsForTests,
} from "@/src/lib/conversation-store";

describe("conversation-store", () => {
    beforeEach(() => {
        _clearSessionsForTests();
    });

    it("generates unique session IDs", () => {
        const a = newSessionId();
        const b = newSessionId();
        expect(a).not.toBe(b);
        expect(a.length).toBeGreaterThan(8);
    });

    it("returns empty history for unknown session", () => {
        expect(getConversationHistory("nonexistent")).toEqual([]);
    });

    it("stores and retrieves conversation turns", () => {
        const sid = "test-session";
        addConversationTurn(sid, "What was the 1965 homecoming?", "It was great.", ["art-1"]);
        const history = getConversationHistory(sid);
        expect(history).toHaveLength(1);
        expect(history[0].question).toBe("What was the 1965 homecoming?");
        expect(history[0].answer).toBe("It was great.");
        expect(history[0].citedArticleIds).toEqual(["art-1"]);
    });

    it("caps at 5 turns (sliding window)", () => {
        const sid = "test-session";
        for (let i = 0; i < 7; i++) {
            addConversationTurn(sid, `Q${i}`, `A${i}`, []);
        }
        const history = getConversationHistory(sid);
        expect(history).toHaveLength(5);
        expect(history[0].question).toBe("Q2");
        expect(history[4].question).toBe("Q6");
    });

    it("truncates long answers to 500 chars", () => {
        const sid = "test-session";
        const longAnswer = "x".repeat(1000);
        addConversationTurn(sid, "Q", longAnswer, []);
        const history = getConversationHistory(sid);
        expect(history[0].answer).toHaveLength(500);
    });

    it("returns a copy of history (not a reference)", () => {
        const sid = "test-session";
        addConversationTurn(sid, "Q1", "A1", []);
        const h1 = getConversationHistory(sid);
        const h2 = getConversationHistory(sid);
        expect(h1).not.toBe(h2);
        expect(h1).toEqual(h2);
    });
});

describe("formatHistoryForPrompt", () => {
    it("returns empty string for no turns", () => {
        expect(formatHistoryForPrompt([])).toBe("");
    });

    it("formats turns with numbered labels", () => {
        const turns = [
            { question: "Q1", answer: "A1", citedArticleIds: [], timestamp: 0 },
            { question: "Q2", answer: "A2", citedArticleIds: [], timestamp: 0 },
        ];
        const result = formatHistoryForPrompt(turns);
        expect(result).toContain("[Turn 1] Q: Q1");
        expect(result).toContain("[Turn 2] Q: Q2");
        expect(result).toContain("A: A1");
        expect(result).toContain("A: A2");
    });
});
