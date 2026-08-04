/**
 * GET /api/ask/session?sessionId=...
 *
 * Returns the conversation turns associated with a session id so the
 * UI can rehydrate a scrolling transcript after a page reload. Each
 * turn carries its full answer, cited article ids, and the matching
 * source-article metadata (headline/date/category/summary/snippet) so
 * the client doesn't need to re-query the articles table itself.
 *
 * Response shape:
 *   {
 *     turns: Array<{
 *       question, answer, citedArticleIds, sourceArticles, timestamp
 *     }>,
 *     expired: boolean   // true iff the session existed but aged out
 *                        // of the 30-min TTL; lets the UI show a
 *                        // "your last conversation expired" banner
 *                        // instead of a silent empty state.
 *   }
 *
 * Rate-limited like the other ask endpoints so a script can't scrape
 * guessed session ids.
 */

import { NextRequest, NextResponse } from "next/server";
import {
    deleteConversationTurns,
    getConversationHistory,
    sessionHasAnyTurns,
} from "@/src/lib/conversation-store";
import { fetchArticlesByIds } from "@/src/lib/db";
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
                    "Retry-After": String(
                        Math.ceil((rate.resetAt - Date.now()) / 1000),
                    ),
                },
            },
        );
    }

    const url = new URL(request.url);
    const sessionId = url.searchParams.get("sessionId") ?? "";
    if (!sessionId || sessionId.length > MAX_SESSION_ID_LEN) {
        return NextResponse.json({ turns: [], expired: false });
    }

    const turns = await getConversationHistory(sessionId);

    // Empty live window could mean "brand new session" or "session aged
    // out". Only probe the DB again when we got nothing back; the extra
    // round-trip is cheap because the index on (session_id, created_at)
    // covers a single-row existence check.
    const expired =
        turns.length === 0 ? await sessionHasAnyTurns(sessionId) : false;

    // Batch-fetch article metadata for every cited article across turns
    // in one query, then re-scatter per-turn so the client can render
    // source cards immediately on hydrate.
    const allIds = Array.from(
        new Set(
            turns.flatMap((turn) => {
                const pinned = new Set(
                    (turn.citationSnapshots ?? []).map(
                        (snapshot) => snapshot.articleId,
                    ),
                );
                return turn.citedArticleIds.filter((id) => !pinned.has(id));
            }),
        ),
    );
    const articleMap = await fetchArticlesByIds(allIds);

    return NextResponse.json({
        turns: turns.map((t) => ({
            question: t.question,
            answer: t.answer,
            // Kept for the transitional ConversationHistory component that
            // still reads `answerSnippet`; removed once that component is
            // deleted in step 9 of the redesign rollout.
            answerSnippet: t.answer,
            citedArticleIds: t.citedArticleIds,
            sourceArticles: t.citedArticleIds.flatMap((id) => {
                const snapshot = (t.citationSnapshots ?? []).find(
                    (candidate) => candidate.articleId === id,
                );
                if (snapshot) {
                    return [{
                        id: snapshot.articleId,
                        contentRevisionId: snapshot.contentRevisionId,
                        headline: snapshot.headline,
                        editionDate: snapshot.editionDate,
                        category: snapshot.category,
                        summary: snapshot.summary,
                        byline: snapshot.byline,
                        bodySnippet: snapshot.bodySnippet,
                        distance: null,
                        imageUrls: snapshot.imageUrls,
                        imageCaptions: snapshot.imageCaptions,
                    }];
                }
                const article = articleMap.get(id);
                return article
                    ? [{
                          id: article.id,
                          headline: article.headline,
                          editionDate: article.editionDate,
                          category: article.category,
                          summary: article.summary,
                          byline: article.byline,
                          bodySnippet: article.bodySnippet,
                          distance: null,
                          imageUrls: article.imageUrls,
                          imageCaptions: article.imageCaptions,
                      }]
                    : [];
            }),
            timestamp: t.timestamp,
        })),
        expired,
    });
}

/**
 * DELETE /api/ask/session?sessionId=...
 *
 * Wipes every stored turn for the session. Called by the "Clear
 * conversation" button so the user's transcript is gone from the
 * server immediately instead of lingering until the 30-min TTL.
 * Returns 204 on success (including deleting zero rows); if the store
 * reports a database failure, returns 500 so the client knows the
 * transcript may still exist server-side.
 */
export async function DELETE(request: NextRequest): Promise<NextResponse> {
    const ip = getClientIp(request);
    const rate = await sessionRateLimiter(ip);
    if (!rate.allowed) {
        return NextResponse.json(
            { error: "Too many session requests. Please wait a moment." },
            {
                status: 429,
                headers: {
                    "Retry-After": String(
                        Math.ceil((rate.resetAt - Date.now()) / 1000),
                    ),
                },
            },
        );
    }

    const url = new URL(request.url);
    const sessionId = url.searchParams.get("sessionId") ?? "";
    if (!sessionId || sessionId.length > MAX_SESSION_ID_LEN) {
        return new NextResponse(null, { status: 204 });
    }

    const result = await deleteConversationTurns(sessionId);
    if (!result.ok) {
        return NextResponse.json(
            { error: "failed to delete conversation" },
            { status: 500 },
        );
    }
    return new NextResponse(null, { status: 204 });
}
