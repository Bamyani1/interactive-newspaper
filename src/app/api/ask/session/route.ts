/**
 * GET /api/ask/session?sessionId=...
 *
 * Returns the conversation turns associated with a session id so the
 * UI can show prior questions in the current conversation. Returns an
 * empty list when the session is unknown or expired.
 *
 * This is a read-only projection of conversation-store; no PII
 * beyond what the client already has. Rate-limited like other ask
 * endpoints so a script can't scrape session ids it guesses.
 */

import { NextRequest, NextResponse } from "next/server";
import { getConversationHistory } from "@/src/lib/conversation-store";
import { createRateLimiter, getClientIp } from "@/src/lib/rate-limit";

export const dynamic = "force-dynamic";

const sessionRateLimiter = createRateLimiter({
    bucket: "ask-session",
    limit: 60,
    windowMs: 60_000,
});

const MAX_SESSION_ID_LEN = 128;

export async function GET(request: NextRequest): Promise<NextResponse> {
    const ip = getClientIp(request);
    const rate = await sessionRateLimiter(ip);
    if (!rate.allowed) {
        return NextResponse.json(
            { error: "Too many session requests. Please wait a moment." },
            {
                status: 429,
                headers: {
                    "Retry-After": String(Math.ceil((rate.resetAt - Date.now()) / 1000)),
                },
            },
        );
    }

    const url = new URL(request.url);
    const sessionId = url.searchParams.get("sessionId") ?? "";
    if (!sessionId || sessionId.length > MAX_SESSION_ID_LEN) {
        return NextResponse.json({ turns: [] });
    }

    const turns = await getConversationHistory(sessionId);
    return NextResponse.json({
        turns: turns.map((t) => ({
            question: t.question,
            answerSnippet: t.answer,
            citedArticleIds: t.citedArticleIds,
            timestamp: t.timestamp,
        })),
    });
}
