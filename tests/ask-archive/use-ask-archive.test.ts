/**
 * Smoke tests for the rewritten useAskArchive hook (reducer + turns[]).
 *
 * The reducer itself is covered exhaustively in ask-reducer.test.ts. These
 * tests focus on hook-level behavior: mount-time hydration, submit
 * dispatches an APPEND_USER + TURN_DONE on the non-streaming fallback
 * path, and error responses produce a TURN_ERROR turn.
 *
 * The streaming SSE path is exercised via the real route in
 * tests/api/ask-route.test.ts; reproducing a full SSE mock here would
 * duplicate that coverage without adding signal.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useAskArchive } from "@/features/ask-archive/hooks/useAskArchive";
import type { AskResponse } from "@/src/types";

const mockResponse: AskResponse = {
    question: "What happened?",
    answer: "Things happened [Source 1].",
    citations: [
        {
            articleId: "1960-01-07-0",
            headline: "Test",
            editionDate: "1960-01-07",
        },
    ],
    confidence: "high",
    mode: "text",
    requestId: "req-1",
    sourceArticles: [
        {
            id: "1960-01-07-0",
            headline: "Test",
            editionDate: "1960-01-07",
            category: "News",
            summary: "Summary",
            byline: null,
            bodySnippet: "Body...",
            distance: 0.25,
            imageUrls: [],
        },
    ],
    meta: {
        retrievalTimeMs: 100,
        generationTimeMs: 500,
        totalTimeMs: 600,
        articlesSearched: 8,
        method: "hybrid",
    },
};

function makeJsonResponse(
    body: unknown,
    overrides: Partial<{ ok: boolean; status: number }> = {},
) {
    return {
        ok: overrides.ok ?? true,
        status: overrides.status ?? 200,
        headers: {
            get: (key: string) =>
                key.toLowerCase() === "content-type"
                    ? "application/json"
                    : null,
        },
        body: null,
        json: () => Promise.resolve(body),
    };
}

// Route /api/ask/session during mount-hydrate to a benign empty reply so
// the initial HYDRATE doesn't throw on missing mocks.
function fetchRouter(askResponse: unknown) {
    return vi.fn((input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/api/ask/session")) {
            return Promise.resolve(
                makeJsonResponse({ turns: [], expired: false }),
            );
        }
        return Promise.resolve(askResponse);
    });
}

describe("useAskArchive", () => {
    beforeEach(() => {
        window.localStorage.clear();
        vi.stubGlobal(
            "fetch",
            fetchRouter(makeJsonResponse(mockResponse)),
        );
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("hydrates with empty turns on mount", async () => {
        const { result } = renderHook(() => useAskArchive());
        expect(result.current.isHydrating).toBe(true);
        await waitFor(() => expect(result.current.isHydrating).toBe(false));
        expect(result.current.turns).toEqual([]);
        expect(result.current.expiredBanner).toBe(false);
    });

    it("does not let a late session restore overwrite newer local interaction", async () => {
        let resolveSession!: (
            response: ReturnType<typeof makeJsonResponse>,
        ) => void;
        const sessionResponse = new Promise<ReturnType<typeof makeJsonResponse>>(
            (resolve) => {
                resolveSession = resolve;
            },
        );
        vi.stubGlobal(
            "fetch",
            vi.fn((input: RequestInfo | URL) => {
                const url =
                    typeof input === "string" ? input : input.toString();
                if (url.includes("/api/ask/session")) return sessionResponse;
                return Promise.resolve(makeJsonResponse(mockResponse));
            }),
        );

        const { result } = renderHook(() => useAskArchive());
        expect(result.current.isHydrating).toBe(true);

        act(() => {
            result.current.submit("Keep this new question");
        });
        await waitFor(() => {
            expect(result.current.turns[0]?.status).toBe("done");
        });

        await act(async () => {
            resolveSession(
                makeJsonResponse({
                    turns: [
                        {
                            question: "Stale restored question",
                            answer: "Stale answer",
                            citedArticleIds: [],
                            timestamp: 1,
                        },
                    ],
                    expired: false,
                }),
            );
            await sessionResponse;
        });
        await waitFor(() => expect(result.current.isHydrating).toBe(false));

        expect(result.current.turns).toHaveLength(1);
        expect(result.current.turns[0].question).toBe(
            "Keep this new question",
        );
    });

    it("on expiry: empties the transcript, removes the expired thread, and mints a fresh session", async () => {
        const expiredSession = "expired-session-1";
        window.localStorage.setItem("owu-ask-session-id", expiredSession);
        window.localStorage.setItem(
            "owu-ask-threads",
            JSON.stringify([
                {
                    sessionId: expiredSession,
                    firstQuestion:
                        "What coverage did the 1969 moon landing get?",
                    turns: [
                        {
                            id: "t1",
                            question:
                                "What coverage did the 1969 moon landing get?",
                            answer: "It got wall-to-wall coverage.",
                            status: "done",
                            sourceArticles: [],
                            citations: [],
                            meta: null,
                            confidence: "medium",
                            requestId: "",
                            mode: "text",
                            createdAt: 1,
                        },
                    ],
                    createdAt: 1,
                    lastUpdatedAt: 1,
                },
            ]),
        );
        vi.stubGlobal(
            "fetch",
            vi.fn((input: RequestInfo | URL) => {
                const url =
                    typeof input === "string" ? input : input.toString();
                if (url.includes("/api/ask/session")) {
                    return Promise.resolve(
                        makeJsonResponse({ turns: [], expired: true }),
                    );
                }
                return Promise.resolve(makeJsonResponse(mockResponse));
            }),
        );

        const { result } = renderHook(() => useAskArchive());
        await waitFor(() => expect(result.current.isHydrating).toBe(false));

        // Banner shows, but nothing from the dead conversation lingers.
        expect(result.current.expiredBanner).toBe(true);
        expect(result.current.turns).toEqual([]);
        // The expired thread is gone from the sidebar…
        expect(result.current.threads).toEqual([]);
        // …and from localStorage.
        expect(
            JSON.parse(
                window.localStorage.getItem("owu-ask-threads") ?? "[]",
            ),
        ).toEqual([]);
        // A fresh session is active, not the dead one.
        expect(result.current.activeThreadId).toBeTruthy();
        expect(result.current.activeThreadId).not.toBe(expiredSession);
        expect(window.localStorage.getItem("owu-ask-session-id")).not.toBe(
            expiredSession,
        );
    });

    it("on expiry: keeps other archived threads while dropping only the expired one", async () => {
        const expiredSession = "expired-session-2";
        const keepSession = "keep-session-2";
        window.localStorage.setItem("owu-ask-session-id", expiredSession);
        window.localStorage.setItem(
            "owu-ask-threads",
            JSON.stringify([
                {
                    sessionId: keepSession,
                    firstQuestion: "An older thread",
                    turns: [
                        {
                            id: "k1",
                            question: "An older thread",
                            answer: "kept",
                            status: "done",
                            sourceArticles: [],
                            citations: [],
                            meta: null,
                            confidence: "medium",
                            requestId: "",
                            mode: "text",
                            createdAt: 1,
                        },
                    ],
                    createdAt: 1,
                    lastUpdatedAt: 1,
                },
                {
                    sessionId: expiredSession,
                    firstQuestion: "The expired thread",
                    turns: [
                        {
                            id: "e1",
                            question: "The expired thread",
                            answer: "gone",
                            status: "done",
                            sourceArticles: [],
                            citations: [],
                            meta: null,
                            confidence: "medium",
                            requestId: "",
                            mode: "text",
                            createdAt: 2,
                        },
                    ],
                    createdAt: 2,
                    lastUpdatedAt: 2,
                },
            ]),
        );
        vi.stubGlobal(
            "fetch",
            vi.fn((input: RequestInfo | URL) => {
                const url =
                    typeof input === "string" ? input : input.toString();
                if (url.includes("/api/ask/session")) {
                    return Promise.resolve(
                        makeJsonResponse({ turns: [], expired: true }),
                    );
                }
                return Promise.resolve(makeJsonResponse(mockResponse));
            }),
        );

        const { result } = renderHook(() => useAskArchive());
        await waitFor(() => expect(result.current.isHydrating).toBe(false));

        expect(result.current.threads.map((t) => t.id)).toEqual([keepSession]);
        expect(result.current.activeThreadId).not.toBe(expiredSession);
        expect(result.current.activeThreadId).not.toBe(keepSession);
    });

    it("submit appends a user turn immediately and completes it via the non-streaming fallback", async () => {
        const { result } = renderHook(() => useAskArchive());
        await waitFor(() => expect(result.current.isHydrating).toBe(false));

        act(() => {
            result.current.submit("What happened?");
        });

        // Optimistic user turn appears synchronously.
        expect(result.current.turns).toHaveLength(1);
        expect(result.current.turns[0].question).toBe("What happened?");
        expect(result.current.turns[0].status).toBe("streaming");

        await waitFor(() => {
            expect(result.current.turns[0].status).toBe("done");
        });
        expect(result.current.turns[0].answer).toBe(
            "Things happened [Source 1].",
        );
        expect(result.current.turns[0].sourceArticles).toHaveLength(1);
    });

    it("submit produces a TURN_ERROR with typed kind when the server returns a typed error", async () => {
        vi.stubGlobal(
            "fetch",
            fetchRouter(
                makeJsonResponse(
                    {
                        kind: "rate_limit",
                        message: "Too many questions",
                        error: "Too many questions",
                        retryAfterSec: 42,
                    },
                    { ok: false, status: 429 },
                ),
            ),
        );

        const { result } = renderHook(() => useAskArchive());
        await waitFor(() => expect(result.current.isHydrating).toBe(false));

        act(() => {
            result.current.submit("q");
        });

        await waitFor(() => {
            expect(result.current.turns[0].status).toBe("error");
        });
        expect(result.current.turns[0].errorKind).toBe("rate_limit");
        expect(result.current.turns[0].errorMessage).toBe("Too many questions");
        expect(result.current.turns[0].retryAfterSec).toBe(42);
    });

    it("clearConversation clears turns, bumps sessionGen, and DELETEs the server session", async () => {
        const fetchSpy = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
            const url = typeof input === "string" ? input : input.toString();
            if (url.includes("/api/ask/session")) {
                if (init?.method === "DELETE") {
                    return Promise.resolve(
                        makeJsonResponse(null, { ok: true, status: 204 }),
                    );
                }
                return Promise.resolve(
                    makeJsonResponse({ turns: [], expired: false }),
                );
            }
            return Promise.resolve(makeJsonResponse(mockResponse));
        });
        vi.stubGlobal("fetch", fetchSpy);

        const { result } = renderHook(() => useAskArchive());
        await waitFor(() => expect(result.current.isHydrating).toBe(false));

        act(() => {
            result.current.submit("q1");
        });
        await waitFor(() => {
            expect(result.current.turns[0].status).toBe("done");
        });

        const genBefore = result.current.sessionGen;
        fetchSpy.mockClear();
        act(() => {
            result.current.clearConversation();
        });
        expect(result.current.turns).toEqual([]);
        expect(result.current.sessionGen).toBe(genBefore + 1);
        // Best-effort DELETE fires against the session route.
        const deleteCall = fetchSpy.mock.calls.find(
            ([, init]) => (init as RequestInit | undefined)?.method === "DELETE",
        );
        expect(deleteCall).toBeDefined();
        expect(String(deleteCall?.[0])).toContain("/api/ask/session?sessionId=");
    });

    it("retry re-submits an errored turn's question as a new turn", async () => {
        // First submit errors out.
        vi.stubGlobal(
            "fetch",
            fetchRouter(
                makeJsonResponse(
                    { kind: "server", message: "Boom" },
                    { ok: false, status: 500 },
                ),
            ),
        );
        const { result } = renderHook(() => useAskArchive());
        await waitFor(() => expect(result.current.isHydrating).toBe(false));

        act(() => {
            result.current.submit("ask once");
        });
        await waitFor(() => {
            expect(result.current.turns[0].status).toBe("error");
        });

        // Swap fetch to succeed the retry.
        vi.stubGlobal("fetch", fetchRouter(makeJsonResponse(mockResponse)));

        act(() => {
            result.current.retry(result.current.turns[0].id);
        });

        await waitFor(() => {
            expect(result.current.turns).toHaveLength(2);
        });
        await waitFor(() => {
            expect(result.current.turns[1].status).toBe("done");
        });
        expect(result.current.turns[1].question).toBe("ask once");
    });
});
