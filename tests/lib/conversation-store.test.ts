/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

// Mock the Neon SQL tag so tests can control each returned row.
const { sqlMock } = vi.hoisted(() => {
    const mock = vi.fn() as ReturnType<typeof vi.fn> & {
        transaction: ReturnType<typeof vi.fn>;
    };
    mock.transaction = vi.fn();
    return { sqlMock: mock };
});
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
    _clearSessionsForTests,
} from "@/src/lib/conversation-store";

describe("conversation-store", () => {
    beforeEach(() => {
        vi.unstubAllEnvs();
        _clearSessionsForTests();
        sqlMock.mockReset();
        sqlMock.transaction.mockReset();
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
                citation_snapshots: [],
                created_at: now,
            },
            {
                question: "Q1",
                answer: "A1",
                cited_article_ids: ["art-1"],
                citation_snapshots: [],
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
        sqlMock.transaction.mockResolvedValueOnce(undefined);
        sqlMock.mockResolvedValueOnce([{ exists: true }]);
        const shortAnswer = "x".repeat(1000);
        await addConversationTurn("sid", "What?", shortAnswer, ["a", "b"]);

        expect(sqlMock).toHaveBeenCalledTimes(4);
        expect(sqlMock.transaction).toHaveBeenCalledTimes(1);
        const substitutions = sqlMock.mock.calls[1].slice(1);
        const stringArgs = substitutions.filter(
            (v: unknown) => typeof v === "string",
        );
        const stored = stringArgs.find(
            (s): s is string => typeof s === "string" && s.startsWith("x"),
        );
        expect(stored).toBe(shortAnswer);
    });

    it("caps over-long answers at 8000 chars with a truncation marker", async () => {
        sqlMock.transaction.mockResolvedValueOnce(undefined);
        sqlMock.mockResolvedValueOnce([{ exists: true }]);
        const longAnswer = "x".repeat(10_000);
        await addConversationTurn("sid", "What?", longAnswer, []);

        const substitutions = sqlMock.mock.calls[1].slice(1);
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
        sqlMock.transaction.mockRejectedValueOnce(new Error("neon down"));
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
                citation_snapshots: null,
                created_at: new Date(),
            },
        ]);
        const history = await getConversationHistory("sid");
        expect(history[0].citedArticleIds).toEqual([]);
        expect(history[0].citationSnapshots).toEqual([]);
    });

    it("stores and restores immutable citation snapshots when the column exists", async () => {
        const snapshot = {
            articleId: "1960-01-07-0",
            contentRevisionId: "legacy-sha256:abc",
            headline: "Original headline",
            editionDate: "1960-01-07",
            category: "News",
            summary: "Original summary",
            byline: "Staff",
            bodySnippet: "Original body",
            evidenceSnippet: "Exact cited evidence",
            imageUrls: [],
            imageCaptions: [],
        };
        sqlMock.mockResolvedValueOnce([{ exists: true }]);
        sqlMock.transaction.mockResolvedValueOnce(undefined);

        await addConversationTurn("sid", "Q", "A", [snapshot.articleId], [snapshot]);

        const insertSql = Array.isArray(sqlMock.mock.calls[1][0])
            ? sqlMock.mock.calls[1][0].join(" ")
            : "";
        expect(insertSql).toContain("citation_snapshots");
        expect(sqlMock.mock.calls[1]).toContain(JSON.stringify([snapshot]));

        sqlMock.mockResolvedValueOnce([
            {
                question: "Q",
                answer: "A",
                cited_article_ids: [snapshot.articleId],
                citation_snapshots: [snapshot],
                created_at: new Date(),
            },
        ]);
        const history = await getConversationHistory("sid");
        expect(history[0].citationSnapshots).toEqual([snapshot]);
    });

    it("uses an ephemeral store and makes no Neon call in evaluation mode", async () => {
        vi.stubEnv("RAG_EVALUATION_MODE", "1");
        await addConversationTurn("eval-session", "Q", "A", ["article-1"]);

        expect(await getConversationHistory("eval-session")).toMatchObject([
            { question: "Q", answer: "A", citedArticleIds: ["article-1"] },
        ]);
        expect(sqlMock).not.toHaveBeenCalled();
        expect(sqlMock.transaction).not.toHaveBeenCalled();
    });
});

describe("formatHistoryForPrompt", () => {
    it("returns empty string for no turns", () => {
        expect(formatHistoryForPrompt([])).toBe("");
    });

    it("formats turns with numbered labels", () => {
        const turns = [
            { question: "Q1", answer: "A1", citedArticleIds: [], citationSnapshots: [], timestamp: 0 },
            { question: "Q2", answer: "A2", citedArticleIds: [], citationSnapshots: [], timestamp: 0 },
        ];
        const result = formatHistoryForPrompt(turns);
        expect(result).toContain("[Turn 1] Q: Q1");
        expect(result).toContain("[Turn 2] Q: Q2");
        expect(result).toContain("A: A1");
        expect(result).toContain("A: A2");
    });
});
