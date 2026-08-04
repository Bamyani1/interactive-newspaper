/**
 * Unit tests for GET /api/ask/session.
 *
 * The session endpoint hydrates a scrolling transcript after reload.
 * Key behaviors:
 *  - turns come back with full `answer` and per-turn sourceArticles
 *  - `expired: true` distinguishes "session aged out" from "never
 *    existed"
 *  - missing / malformed sessionId returns an empty, non-expired body
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/src/lib/conversation-store", () => ({
    getConversationHistory: vi.fn(async () => []),
    sessionHasAnyTurns: vi.fn(async () => false),
    deleteConversationTurns: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/src/lib/db", () => ({
    fetchArticlesByIds: vi.fn(async () => new Map()),
}));

vi.mock("@/src/lib/rate-limit", () => ({
    createRateLimiter: () => () => ({
        allowed: true,
        resetAt: Date.now() + 60_000,
    }),
    getClientIp: () => "127.0.0.1",
}));

import { DELETE, GET } from "@/src/app/api/ask/session/route";
import {
    deleteConversationTurns,
    getConversationHistory,
    sessionHasAnyTurns,
} from "@/src/lib/conversation-store";
import { fetchArticlesByIds } from "@/src/lib/db";

function makeRequest(
    sessionId?: string,
    method: "GET" | "DELETE" = "GET",
): NextRequest {
    const url =
        sessionId !== undefined
            ? `http://localhost/api/ask/session?sessionId=${encodeURIComponent(sessionId)}`
            : "http://localhost/api/ask/session";
    return new NextRequest(url, { method });
}

describe("GET /api/ask/session", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (getConversationHistory as ReturnType<typeof vi.fn>).mockResolvedValue(
            [],
        );
        (sessionHasAnyTurns as ReturnType<typeof vi.fn>).mockResolvedValue(
            false,
        );
        (fetchArticlesByIds as ReturnType<typeof vi.fn>).mockResolvedValue(
            new Map(),
        );
    });

    it("returns empty turns + expired:false for a fresh sessionId with no history at all", async () => {
        const response = await GET(makeRequest("fresh-sid"));
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.turns).toEqual([]);
        expect(body.expired).toBe(false);
    });

    it("returns empty turns + expired:true when the session existed but aged out of the TTL window", async () => {
        (getConversationHistory as ReturnType<typeof vi.fn>).mockResolvedValue(
            [],
        );
        (sessionHasAnyTurns as ReturnType<typeof vi.fn>).mockResolvedValue(
            true,
        );

        const response = await GET(makeRequest("aged-sid"));
        const body = await response.json();

        expect(body.turns).toEqual([]);
        expect(body.expired).toBe(true);
    });

    it("hydrates each turn with its full answer and sourceArticles fetched from the articles table", async () => {
        (getConversationHistory as ReturnType<typeof vi.fn>).mockResolvedValue([
            {
                question: "Q1",
                answer: "Full answer for turn 1. ".repeat(40),
                citedArticleIds: ["1960-01-07-0", "1960-01-14-2"],
                timestamp: 1_700_000_000_000,
            },
            {
                question: "Q2",
                answer: "Full answer for turn 2.",
                citedArticleIds: ["1960-01-07-0"],
                timestamp: 1_700_000_100_000,
            },
        ]);
        (fetchArticlesByIds as ReturnType<typeof vi.fn>).mockResolvedValue(
            new Map([
                [
                    "1960-01-07-0",
                    {
                        id: "1960-01-07-0",
                        headline: "Article A",
                        editionDate: "1960-01-07",
                        category: "News",
                        summary: "Summary A",
                        byline: "Writer A",
                        bodySnippet: "Body A…",
                        imageUrls: [],
                        imageCaptions: [],
                    },
                ],
                [
                    "1960-01-14-2",
                    {
                        id: "1960-01-14-2",
                        headline: "Article B",
                        editionDate: "1960-01-14",
                        category: "Sports",
                        summary: "Summary B",
                        byline: null,
                        bodySnippet: "Body B…",
                        imageUrls: ["https://example.com/b.jpg"],
                        imageCaptions: ["Caption B"],
                    },
                ],
            ]),
        );

        const response = await GET(makeRequest("live-sid"));
        const body = await response.json();

        expect(body.expired).toBe(false);
        expect(body.turns).toHaveLength(2);
        expect(body.turns[0].question).toBe("Q1");
        expect(body.turns[0].answer.length).toBeGreaterThan(500); // not a snippet anymore
        expect(body.turns[0].sourceArticles).toHaveLength(2);
        expect(body.turns[0].sourceArticles[0].id).toBe("1960-01-07-0");
        expect(body.turns[0].sourceArticles[0].headline).toBe("Article A");
        expect(body.turns[0].sourceArticles[1].id).toBe("1960-01-14-2");

        // Turn 2 only references one article — the same first one.
        expect(body.turns[1].sourceArticles).toHaveLength(1);
        expect(body.turns[1].sourceArticles[0].id).toBe("1960-01-07-0");

        // Articles table should be hit only once for all unique ids across turns.
        expect(fetchArticlesByIds).toHaveBeenCalledTimes(1);
        const callArg = (fetchArticlesByIds as ReturnType<typeof vi.fn>).mock
            .calls[0][0] as string[];
        expect(callArg.sort()).toEqual(["1960-01-07-0", "1960-01-14-2"]);
    });

    it("silently drops citations whose article has been deleted since the turn was recorded", async () => {
        (getConversationHistory as ReturnType<typeof vi.fn>).mockResolvedValue([
            {
                question: "Q1",
                answer: "A1",
                citedArticleIds: ["1960-01-07-0", "deleted-id"],
                timestamp: 1_700_000_000_000,
            },
        ]);
        (fetchArticlesByIds as ReturnType<typeof vi.fn>).mockResolvedValue(
            new Map([
                [
                    "1960-01-07-0",
                    {
                        id: "1960-01-07-0",
                        headline: "Article A",
                        editionDate: "1960-01-07",
                        category: "News",
                        summary: "Summary A",
                        byline: null,
                        bodySnippet: "Body A…",
                        imageUrls: [],
                        imageCaptions: [],
                    },
                ],
            ]),
        );

        const response = await GET(makeRequest("live-sid"));
        const body = await response.json();

        expect(body.turns[0].sourceArticles).toHaveLength(1);
        expect(body.turns[0].sourceArticles[0].id).toBe("1960-01-07-0");
    });

    it("hydrates from the pinned citation revision instead of a later article row", async () => {
        (getConversationHistory as ReturnType<typeof vi.fn>).mockResolvedValue([
            {
                question: "Q1",
                answer: "Original answer",
                citedArticleIds: ["1960-01-07-0"],
                citationSnapshots: [
                    {
                        articleId: "1960-01-07-0",
                        contentRevisionId: "legacy-sha256:original",
                        headline: "Original headline",
                        editionDate: "1960-01-07",
                        category: "News",
                        summary: "Original summary",
                        byline: "Original writer",
                        bodySnippet: "Original body",
                        evidenceSnippet: "Original cited evidence",
                        imageUrls: [],
                        imageCaptions: [],
                    },
                ],
                timestamp: 1_700_000_000_000,
            },
        ]);

        const response = await GET(makeRequest("pinned-sid"));
        const body = await response.json();

        expect(fetchArticlesByIds).toHaveBeenCalledWith([]);
        expect(body.turns[0].sourceArticles[0]).toMatchObject({
            id: "1960-01-07-0",
            contentRevisionId: "legacy-sha256:original",
            headline: "Original headline",
            summary: "Original summary",
            bodySnippet: "Original body",
        });
    });

    it("returns empty body without probing when sessionId is missing", async () => {
        const response = await GET(makeRequest(undefined));
        const body = await response.json();

        expect(body.turns).toEqual([]);
        expect(body.expired).toBe(false);
        expect(getConversationHistory).not.toHaveBeenCalled();
        expect(sessionHasAnyTurns).not.toHaveBeenCalled();
    });

    it("returns empty body when sessionId is absurdly long (>128 chars)", async () => {
        const longId = "x".repeat(200);
        const response = await GET(makeRequest(longId));
        const body = await response.json();

        expect(body.turns).toEqual([]);
        expect(body.expired).toBe(false);
        expect(getConversationHistory).not.toHaveBeenCalled();
    });
});

describe("DELETE /api/ask/session", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (
            deleteConversationTurns as ReturnType<typeof vi.fn>
        ).mockResolvedValue({ ok: true });
    });

    it("wipes the session's turns and returns 204", async () => {
        const response = await DELETE(makeRequest("sid-to-clear", "DELETE"));

        expect(response.status).toBe(204);
        expect(deleteConversationTurns).toHaveBeenCalledTimes(1);
        expect(deleteConversationTurns).toHaveBeenCalledWith("sid-to-clear");
    });

    it("returns 500 with an error body when the store reports a failed delete", async () => {
        (
            deleteConversationTurns as ReturnType<typeof vi.fn>
        ).mockResolvedValue({ ok: false, error: "neon down" });

        const response = await DELETE(makeRequest("sid-to-clear", "DELETE"));

        expect(response.status).toBe(500);
        await expect(response.json()).resolves.toEqual({
            error: "failed to delete conversation",
        });
    });

    it("is a no-op 204 when sessionId is missing (no DB call)", async () => {
        const response = await DELETE(makeRequest(undefined, "DELETE"));

        expect(response.status).toBe(204);
        expect(deleteConversationTurns).not.toHaveBeenCalled();
    });

    it("rejects an absurdly long sessionId without touching the DB", async () => {
        const longId = "x".repeat(200);
        const response = await DELETE(makeRequest(longId, "DELETE"));

        expect(response.status).toBe(204);
        expect(deleteConversationTurns).not.toHaveBeenCalled();
    });
});
