/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

// Mock the Neon SQL tag so tests can control each returned row.
const { sqlMock } = vi.hoisted(() => ({ sqlMock: vi.fn() }));
vi.mock("@neondatabase/serverless", () => ({ neon: () => sqlMock }));

// Ensure lazy getSql() returns our mock (requires a non-empty URL).
beforeAll(() => {
    process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgres://fake/test";
});

import {
    getConversationHistory,
    addConversationTurn,
    newSessionId,
    formatHistoryForPrompt,
} from "@/src/lib/conversation-store";

describe("conversation-store", () => {
    beforeEach(() => {
        sqlMock.mockReset();
    });

    it("generates unique session IDs", () => {
        const a = newSessionId();
        const b = newSessionId();
        expect(a).not.toBe(b);
        expect(a.length).toBeGreaterThan(8);
    });

    it("returns empty history when the DB returns no rows", async () => {
        sqlMock.mockResolvedValueOnce([]);
        expect(await getConversationHistory("unknown-session")).toEqual([]);
    });

    it("maps DB rows to ConversationTurn objects in chronological order", async () => {
        // The SELECT orders DESC so we pass newest first; the function
        // reverses internally to return oldest-first.
        const now = new Date("2026-04-16T12:00:00Z");
        sqlMock.mockResolvedValueOnce([
            {
                question: "Q2",
                answer: "A2",
                cited_article_ids: ["art-2"],
                created_at: now,
            },
            {
                question: "Q1",
                answer: "A1",
                cited_article_ids: ["art-1"],
                created_at: new Date(now.getTime() - 1000),
            },
        ]);

        const history = await getConversationHistory("sid");
        expect(history).toHaveLength(2);
        expect(history[0].question).toBe("Q1");
        expect(history[1].question).toBe("Q2");
        expect(history[0].citedArticleIds).toEqual(["art-1"]);
        expect(history[1].citedArticleIds).toEqual(["art-2"]);
    });

    it("stores short answers verbatim on addConversationTurn", async () => {
        sqlMock.mockResolvedValueOnce(undefined);
        const shortAnswer = "x".repeat(1000);
        await addConversationTurn("sid", "What?", shortAnswer, ["a", "b"]);

        expect(sqlMock).toHaveBeenCalledTimes(1);
        const substitutions = sqlMock.mock.calls[0].slice(1);
        const stringArgs = substitutions.filter(
            (v: unknown) => typeof v === "string",
        );
        const stored = stringArgs.find(
            (s): s is string => typeof s === "string" && s.startsWith("x"),
        );
        expect(stored).toBe(shortAnswer);
    });

    it("caps over-long answers at 8000 chars with a truncation marker", async () => {
        sqlMock.mockResolvedValueOnce(undefined);
        const longAnswer = "x".repeat(10_000);
        await addConversationTurn("sid", "What?", longAnswer, []);

        const substitutions = sqlMock.mock.calls[0].slice(1);
        const stringArgs = substitutions.filter(
            (v: unknown) => typeof v === "string",
        );
        const stored = stringArgs.find(
            (s): s is string => typeof s === "string" && s.startsWith("x"),
        );
        expect(stored).toBeDefined();
        expect(stored!.length).toBe(8000);
        expect(stored!.endsWith("[…truncated]")).toBe(true);
    });

    it("does not throw when the DB read fails", async () => {
        sqlMock.mockRejectedValueOnce(new Error("neon down"));
        await expect(getConversationHistory("sid")).resolves.toEqual([]);
    });

    it("does not throw when the DB write fails", async () => {
        sqlMock.mockRejectedValueOnce(new Error("neon down"));
        await expect(
            addConversationTurn("sid", "Q", "A", []),
        ).resolves.toBeUndefined();
    });

    it("treats a nullish cited_article_ids as an empty array", async () => {
        sqlMock.mockResolvedValueOnce([
            {
                question: "Q",
                answer: "A",
                cited_article_ids: null,
                created_at: new Date(),
            },
        ]);
        const history = await getConversationHistory("sid");
        expect(history[0].citedArticleIds).toEqual([]);
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
