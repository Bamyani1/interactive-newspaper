/**
 * POST /api/ask/feedback — user feedback on a RAG answer
 *
 * Body: {
 *   requestId: string,
 *   vote: "up" | "down",
 *   question: string,
 *   answer: string,
 *   confidence?: "low" | "medium" | "high",
 *   mode?: "text" | "visual",
 *   citations?: Citation[],
 *   comment?: string,
 * }
 *
 * Stores the row in `ask_feedback`. Rate-limited to 20/min/IP. The
 * client is trusted to pass back the answer it just received — this
 * endpoint isn't a source of truth, it's signal collection. Feedback
 * is best-effort: if the insert fails, the client still gets a 500
 * but nothing else in the pipeline is affected.
 */

import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { createRateLimiter, getClientIp } from "@/src/lib/rate-limit";

const MAX_QUESTION_LENGTH = 1000;
const MAX_ANSWER_LENGTH = 20_000;
const MAX_COMMENT_LENGTH = 1000;

const feedbackRateLimiter = createRateLimiter({ bucket: "feedback", limit: 20, windowMs: 60_000 });

const sql = neon(process.env.DATABASE_URL!);

interface Citation {
    articleId: string;
    headline: string;
    editionDate: string;
}

interface FeedbackBody {
    requestId: unknown;
    vote: unknown;
    question: unknown;
    answer: unknown;
    confidence?: unknown;
    mode?: unknown;
    citations?: unknown;
    comment?: unknown;
    sessionId?: unknown;
}

function isStringArrayOfShape(
    value: unknown,
    check: (item: unknown) => boolean,
): boolean {
    return Array.isArray(value) && value.every(check);
}

function isCitation(value: unknown): value is Citation {
    if (!value || typeof value !== "object") return false;
    const obj = value as Record<string, unknown>;
    return (
        typeof obj.articleId === "string" &&
        typeof obj.headline === "string" &&
        typeof obj.editionDate === "string"
    );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
    // ── Rate limit ──
    const ip = getClientIp(request);
    const rate = await feedbackRateLimiter(ip);
    if (!rate.allowed) {
        return NextResponse.json(
            { error: "Too many feedback submissions. Try again shortly." },
            {
                status: 429,
                headers: {
                    "X-RateLimit-Limit": String(rate.limit),
                    "X-RateLimit-Remaining": "0",
                    "X-RateLimit-Reset": String(rate.resetAt),
                },
            },
        );
    }

    // ── Parse ──
    let body: FeedbackBody;
    try {
        body = (await request.json()) as FeedbackBody;
    } catch {
        return NextResponse.json(
            { error: "Invalid JSON body" },
            { status: 400 },
        );
    }

    // ── Validate ──
    if (typeof body.requestId !== "string" || body.requestId.trim() === "") {
        return NextResponse.json(
            { error: "requestId is required and must be a non-empty string" },
            { status: 400 },
        );
    }
    if (body.vote !== "up" && body.vote !== "down") {
        return NextResponse.json(
            { error: 'vote must be "up" or "down"' },
            { status: 400 },
        );
    }
    if (
        typeof body.question !== "string" ||
        body.question.trim() === "" ||
        body.question.length > MAX_QUESTION_LENGTH
    ) {
        return NextResponse.json(
            { error: `question must be a non-empty string <= ${MAX_QUESTION_LENGTH} chars` },
            { status: 400 },
        );
    }
    if (
        typeof body.answer !== "string" ||
        body.answer.length > MAX_ANSWER_LENGTH
    ) {
        return NextResponse.json(
            { error: `answer must be a string <= ${MAX_ANSWER_LENGTH} chars` },
            { status: 400 },
        );
    }

    const confidence =
        body.confidence === "low" || body.confidence === "medium" || body.confidence === "high"
            ? body.confidence
            : null;
    const mode = body.mode === "text" || body.mode === "visual" ? body.mode : null;

    const citations: Citation[] = isStringArrayOfShape(body.citations, isCitation)
        ? (body.citations as Citation[])
        : [];

    let comment: string | null = null;
    if (body.comment !== undefined && body.comment !== null) {
        if (typeof body.comment !== "string") {
            return NextResponse.json(
                { error: "comment must be a string" },
                { status: 400 },
            );
        }
        if (body.comment.length > MAX_COMMENT_LENGTH) {
            return NextResponse.json(
                { error: `comment must be <= ${MAX_COMMENT_LENGTH} chars` },
                { status: 400 },
            );
        }
        const trimmed = body.comment.trim();
        comment = trimmed === "" ? null : trimmed;
    }

    // sessionId is optional. Stored so the feedback export CLI can
    // correlate votes with the conversation they came from.
    let sessionId: string | null = null;
    if (typeof body.sessionId === "string" && body.sessionId.trim() !== "") {
        sessionId = body.sessionId.trim().slice(0, 128);
    }

    // ── Insert ──
    // The table has CREATE INDEX on request_id for grouping, but we don't
    // dedupe — a user can vote, change their mind, and vote again. Each
    // click is its own row. Aggregation happens at query time.
    try {
        await sql`
            INSERT INTO ask_feedback
              (request_id, question, answer, confidence, mode, citations, vote, comment, session_id)
            VALUES (
              ${body.requestId},
              ${body.question},
              ${body.answer},
              ${confidence},
              ${mode},
              ${JSON.stringify(citations)}::jsonb,
              ${body.vote},
              ${comment},
              ${sessionId}
            )
        `;
    } catch (err) {
        console.error(
            JSON.stringify({
                level: "error",
                route: "/api/ask/feedback",
                requestId: body.requestId,
                stage: "feedback",
                msg: "insert failed",
                err: err instanceof Error ? err.message : String(err),
            }),
        );
        return NextResponse.json(
            { error: "Failed to record feedback. Please try again." },
            { status: 500 },
        );
    }

    return NextResponse.json({ ok: true }, { status: 201 });
}
