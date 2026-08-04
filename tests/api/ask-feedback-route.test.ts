/**
 * Unit tests for POST /api/ask/feedback.
 *
 * Neon is mocked via vi.hoisted so each test can control the INSERT
 * outcome. The route module imports `neon` and calls it once at
 * module-eval time, so we reset call history (not module state)
 * between tests.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSql } = vi.hoisted(() => {
    const fn = vi.fn() as ReturnType<typeof vi.fn>;
    return { mockSql: fn };
});

vi.mock("@neondatabase/serverless", () => ({
    neon: vi.fn(() => mockSql),
}));

import { POST } from "@/src/app/api/ask/feedback/route";

function makeRequest(
    body: unknown,
    opts: { ip?: string } = {},
): Request {
    const headers = new Headers({ "Content-Type": "application/json" });
    if (opts.ip) headers.set("x-forwarded-for", opts.ip);
    return new Request("http://localhost/api/ask/feedback", {
        method: "POST",
        headers,
        body: typeof body === "string" ? body : JSON.stringify(body),
    });
}

const validBody = {
    requestId: "abc123",
    vote: "up" as const,
    question: "What happened in 1965?",
    answer: "Many things happened [Source 1].",
    confidence: "high" as const,
    mode: "text" as const,
    citations: [
        { articleId: "1965-01-07-0", headline: "Test", editionDate: "1965-01-07" },
    ],
};

describe("POST /api/ask/feedback", () => {
    beforeEach(() => {
        vi.unstubAllEnvs();
        vi.clearAllMocks();
        mockSql.mockResolvedValue(undefined);
    });

    it("returns 201 on a valid up-vote with citations", async () => {
        const response = await POST(makeRequest(validBody) as unknown as Parameters<typeof POST>[0]);
        expect(response.status).toBe(201);
        const body = await response.json();
        expect(body.ok).toBe(true);
        expect(mockSql).toHaveBeenCalledTimes(1);
    });

    it("returns 201 on a valid down-vote with comment", async () => {
        const response = await POST(
            makeRequest({
                ...validBody,
                vote: "down",
                comment: "Answer cut off mid-sentence.",
            }) as unknown as Parameters<typeof POST>[0],
        );
        expect(response.status).toBe(201);
        expect(mockSql).toHaveBeenCalledTimes(1);
    });

    it("validates but does not persist feedback in evaluation mode", async () => {
        vi.stubEnv("RAG_EVALUATION_MODE", "1");
        const response = await POST(
            makeRequest(validBody) as unknown as Parameters<typeof POST>[0],
        );
        expect(response.status).toBe(202);
        await expect(response.json()).resolves.toMatchObject({
            ok: true,
            persisted: false,
            evaluationMode: true,
        });
        expect(mockSql).not.toHaveBeenCalled();
    });

    it("rejects an invalid JSON body with 400", async () => {
        const response = await POST(
            makeRequest("not json {") as unknown as Parameters<typeof POST>[0],
        );
        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.error).toMatch(/Invalid JSON/);
        expect(mockSql).not.toHaveBeenCalled();
    });

    it("rejects missing requestId with 400", async () => {
        const { requestId, ...rest } = validBody;
        void requestId;
        const response = await POST(
            makeRequest(rest) as unknown as Parameters<typeof POST>[0],
        );
        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.error).toMatch(/requestId/);
        expect(mockSql).not.toHaveBeenCalled();
    });

    it("rejects empty requestId with 400", async () => {
        const response = await POST(
            makeRequest({ ...validBody, requestId: "   " }) as unknown as Parameters<typeof POST>[0],
        );
        expect(response.status).toBe(400);
    });

    it("rejects vote != up/down with 400", async () => {
        const response = await POST(
            makeRequest({ ...validBody, vote: "maybe" }) as unknown as Parameters<typeof POST>[0],
        );
        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.error).toMatch(/vote/);
    });

    it("rejects missing question with 400", async () => {
        const { question, ...rest } = validBody;
        void question;
        const response = await POST(
            makeRequest(rest) as unknown as Parameters<typeof POST>[0],
        );
        expect(response.status).toBe(400);
    });

    it("rejects question over MAX_QUESTION_LENGTH with 400", async () => {
        const huge = "a".repeat(1001);
        const response = await POST(
            makeRequest({ ...validBody, question: huge }) as unknown as Parameters<typeof POST>[0],
        );
        expect(response.status).toBe(400);
    });

    it("rejects comment over MAX_COMMENT_LENGTH with 400", async () => {
        const huge = "b".repeat(1001);
        const response = await POST(
            makeRequest({
                ...validBody,
                vote: "down",
                comment: huge,
            }) as unknown as Parameters<typeof POST>[0],
        );
        expect(response.status).toBe(400);
    });

    it("sanitizes an empty/whitespace comment to null", async () => {
        mockSql.mockResolvedValueOnce(undefined);
        await POST(
            makeRequest({ ...validBody, vote: "down", comment: "   " }) as unknown as Parameters<typeof POST>[0],
        );
        // Tagged-template call: first arg is strings array, rest are interpolated values.
        const [, ...values] = mockSql.mock.calls[0];
        // comment is the 8th interpolated value (request_id, question, answer, confidence, mode, citations, vote, comment)
        expect(values[7]).toBeNull();
    });

    it("drops unknown confidence values", async () => {
        await POST(
            makeRequest({ ...validBody, confidence: "super-high" }) as unknown as Parameters<typeof POST>[0],
        );
        const [, ...values] = mockSql.mock.calls[0];
        // confidence is the 4th interpolated value
        expect(values[3]).toBeNull();
    });

    it("accepts a citation with a valid contentRevisionId and persists it in the INSERT", async () => {
        const citation = {
            articleId: "1965-01-07-0",
            headline: "Test",
            editionDate: "1965-01-07",
            contentRevisionId: "legacy-sha256:abc_DEF-123",
        };
        const response = await POST(
            makeRequest({ ...validBody, citations: [citation] }) as unknown as Parameters<typeof POST>[0],
        );
        expect(response.status).toBe(201);
        // citations is the 6th interpolated value (request_id, question,
        // answer, confidence, mode, citations, vote, comment).
        const [, ...values] = mockSql.mock.calls[0];
        expect(JSON.parse(values[5] as string)).toEqual([citation]);
    });

    it.each([
        ["object", { pin: true }],
        ["300-char string", "a".repeat(300)],
        ["bad charset", "rev id!with spaces/slashes"],
    ])(
        "rejects a citation whose contentRevisionId is malformed (%s)",
        async (_label, contentRevisionId) => {
            const citation = {
                articleId: "1965-01-07-0",
                headline: "Test",
                editionDate: "1965-01-07",
                contentRevisionId,
            };
            const response = await POST(
                makeRequest({ ...validBody, citations: [citation] }) as unknown as Parameters<typeof POST>[0],
            );
            // Invalid citations don't fail the request — like other invalid
            // citations today, the citations array falls back to [].
            expect(response.status).toBe(201);
            const [, ...values] = mockSql.mock.calls[0];
            expect(JSON.parse(values[5] as string)).toEqual([]);
        },
    );

    it("returns 500 when the DB insert fails", async () => {
        mockSql.mockRejectedValueOnce(new Error("connection refused"));
        const response = await POST(
            makeRequest(validBody) as unknown as Parameters<typeof POST>[0],
        );
        expect(response.status).toBe(500);
        const body = await response.json();
        expect(body.error).toMatch(/Failed to record feedback/);
    });
});
