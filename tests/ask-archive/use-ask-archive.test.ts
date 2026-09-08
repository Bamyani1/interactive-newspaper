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
import { makeSseResponse, type ControlledSse } from "./support/sse-response";

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
    } as unknown as AskResponse["sourceArticles"][number],
  ],
  meta: {
    retrievalTimeMs: 100,
    generationTimeMs: 500,
    totalTimeMs: 600,
    articlesSearched: 8,
    method: "hybrid",
  },
};

function makeJsonResponse(body: unknown, overrides: Partial<{ ok: boolean; status: number }> = {}) {
  return {
    ok: overrides.ok ?? true,
    status: overrides.status ?? 200,
    headers: {
      get: (key: string) => (key.toLowerCase() === "content-type" ? "application/json" : null),
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
      return Promise.resolve(makeJsonResponse({ turns: [], expired: false }));
    }
    return Promise.resolve(askResponse);
  });
}

describe("useAskArchive", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal("fetch", fetchRouter(makeJsonResponse(mockResponse)));
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
    let resolveSession!: (response: ReturnType<typeof makeJsonResponse>) => void;
    const sessionResponse = new Promise<ReturnType<typeof makeJsonResponse>>((resolve) => {
      resolveSession = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/api/ask/session")) return sessionResponse;
        return Promise.resolve(makeJsonResponse(mockResponse));
      })
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
        })
      );
      await sessionResponse;
    });
    await waitFor(() => expect(result.current.isHydrating).toBe(false));

    expect(result.current.turns).toHaveLength(1);
    expect(result.current.turns[0].question).toBe("Keep this new question");

    // The restore also has to leave a thread pointer behind. Without one
    // the persist effect has nothing to file under, so a conversation
    // begun during hydration was never archived — it disappeared on the
    // next reload with no way back to it.
    expect(result.current.activeThreadId).toBeTruthy();
    await waitFor(() => {
      const stored = window.localStorage.getItem("owu-ask-threads") ?? "[]";
      expect(stored).toContain("Keep this new question");
    });
  });

  it("on expiry: keeps the conversation readable and raises the banner", async () => {
    const expiredSession = "expired-session-1";
    window.localStorage.setItem("owu-ask-session-id", expiredSession);
    window.localStorage.setItem(
      "owu-ask-threads",
      JSON.stringify([
        {
          sessionId: expiredSession,
          firstQuestion: "What coverage did the 1969 moon landing get?",
          turns: [
            {
              id: "t1",
              question: "What coverage did the 1969 moon landing get?",
              answer: "It got wall-to-wall coverage.",
              status: "done",
              sourceArticles: [],
              citations: [],
              meta: null,
              confidence: "medium",
              requestId: "",
              mode: "text",
              createdAt: Date.now() - 60_000,
            },
          ],
          createdAt: Date.now() - 60_000,
          lastUpdatedAt: Date.now() - 60_000,
        },
      ])
    );
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/api/ask/session")) {
          return Promise.resolve(makeJsonResponse({ turns: [], expired: true }));
        }
        return Promise.resolve(makeJsonResponse(mockResponse));
      })
    );

    const { result } = renderHook(() => useAskArchive());
    await waitFor(() => expect(result.current.isHydrating).toBe(false));

    // What expired is the server's memory of the conversation, not the
    // conversation: the transcript is local and still worth reading.
    // Deleting it here threw away a thread up to a week old, and minting
    // a new session id orphaned the archived copy from its own key.
    expect(result.current.expiredBanner).toBe(true);
    expect(result.current.turns.map((t) => t.question)).toEqual([
      "What coverage did the 1969 moon landing get?",
    ]);
    expect(result.current.turns[0].answer).toBe("It got wall-to-wall coverage.");
    expect(result.current.threads.map((t) => t.id)).toEqual([expiredSession]);
    expect(result.current.activeThreadId).toBe(expiredSession);
    expect(window.localStorage.getItem("owu-ask-session-id")).toBe(expiredSession);
    expect(JSON.parse(window.localStorage.getItem("owu-ask-threads") ?? "[]")).toHaveLength(1);
  });

  it("on expiry: leaves every other archived thread exactly where it was", async () => {
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
          createdAt: Date.now() - 60_000,
          lastUpdatedAt: Date.now() - 60_000,
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
              createdAt: Date.now() - 120_000,
            },
          ],
          createdAt: Date.now() - 120_000,
          lastUpdatedAt: Date.now() - 120_000,
        },
      ])
    );
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/api/ask/session")) {
          return Promise.resolve(makeJsonResponse({ turns: [], expired: true }));
        }
        return Promise.resolve(makeJsonResponse(mockResponse));
      })
    );

    const { result } = renderHook(() => useAskArchive());
    await waitFor(() => expect(result.current.isHydrating).toBe(false));

    // Most-recent first, and both are still there.
    expect(result.current.threads.map((t) => t.id)).toEqual([keepSession, expiredSession]);
    expect(result.current.activeThreadId).toBe(expiredSession);
  });

  it("prunes archived threads older than the 7-day retention window on load", async () => {
    const DAY = 24 * 60 * 60 * 1000;
    window.localStorage.setItem("owu-ask-session-id", "current-session");
    window.localStorage.setItem(
      "owu-ask-threads",
      JSON.stringify([
        {
          sessionId: "stale-85d",
          firstQuestion: "Tell me about campus protests in 1968.",
          turns: [
            {
              id: "s1",
              question: "Tell me about campus protests in 1968.",
              answer: "old",
              status: "done",
              sourceArticles: [],
              citations: [],
              meta: null,
              confidence: "medium",
              requestId: "",
              mode: "text",
              createdAt: Date.now() - 85 * DAY,
            },
          ],
          createdAt: Date.now() - 85 * DAY,
          lastUpdatedAt: Date.now() - 85 * DAY,
        },
        {
          sessionId: "fresh-2h",
          firstQuestion: "Tell me about the 1969 moon landing.",
          turns: [
            {
              id: "f1",
              question: "Tell me about the 1969 moon landing.",
              answer: "recent",
              status: "done",
              sourceArticles: [],
              citations: [],
              meta: null,
              confidence: "medium",
              requestId: "",
              mode: "text",
              createdAt: Date.now() - 2 * 60 * 60 * 1000,
            },
          ],
          createdAt: Date.now() - 2 * 60 * 60 * 1000,
          lastUpdatedAt: Date.now() - 2 * 60 * 60 * 1000,
        },
      ])
    );

    const { result } = renderHook(() => useAskArchive());
    await waitFor(() => expect(result.current.isHydrating).toBe(false));

    // Only the recent thread survives in the sidebar…
    expect(result.current.threads.map((t) => t.id)).toEqual(["fresh-2h"]);
    // …and the stale one is physically gone from localStorage.
    const stored = JSON.parse(window.localStorage.getItem("owu-ask-threads") ?? "[]") as Array<{
      sessionId: string;
    }>;
    expect(stored.map((t) => t.sessionId)).toEqual(["fresh-2h"]);
  });

  it("keeps threads just under the retention window and drops those just over", async () => {
    const DAY = 24 * 60 * 60 * 1000;
    const HOUR = 60 * 60 * 1000;
    window.localStorage.setItem("owu-ask-session-id", "current-session-2");
    window.localStorage.setItem(
      "owu-ask-threads",
      JSON.stringify([
        {
          sessionId: "under-7d",
          firstQuestion: "Just inside the window",
          turns: [
            {
              id: "u1",
              question: "Just inside the window",
              answer: "kept",
              status: "done",
              sourceArticles: [],
              citations: [],
              meta: null,
              confidence: "medium",
              requestId: "",
              mode: "text",
              createdAt: Date.now() - (7 * DAY - HOUR),
            },
          ],
          createdAt: Date.now() - (7 * DAY - HOUR),
          lastUpdatedAt: Date.now() - (7 * DAY - HOUR),
        },
        {
          sessionId: "over-7d",
          firstQuestion: "Just outside the window",
          turns: [
            {
              id: "o1",
              question: "Just outside the window",
              answer: "dropped",
              status: "done",
              sourceArticles: [],
              citations: [],
              meta: null,
              confidence: "medium",
              requestId: "",
              mode: "text",
              createdAt: Date.now() - (7 * DAY + HOUR),
            },
          ],
          createdAt: Date.now() - (7 * DAY + HOUR),
          lastUpdatedAt: Date.now() - (7 * DAY + HOUR),
        },
      ])
    );

    const { result } = renderHook(() => useAskArchive());
    await waitFor(() => expect(result.current.isHydrating).toBe(false));

    expect(result.current.threads.map((t) => t.id)).toEqual(["under-7d"]);
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
    expect(result.current.turns[0].answer).toBe("Things happened [Source 1].");
    expect(result.current.turns[0].sourceArticles).toHaveLength(1);
  });

  it("archives each thread under its own session when a new conversation starts mid-flow", async () => {
    const { result } = renderHook(() => useAskArchive());
    await waitFor(() => expect(result.current.isHydrating).toBe(false));

    act(() => {
      result.current.submit("First question");
    });
    await waitFor(() => expect(result.current.turns[0].status).toBe("done"));

    // A deep link arriving on an open conversation does exactly this:
    // start a new thread, then submit, in the same tick. The persistence
    // effect used to read the session id from a ref that newConversation
    // had already repointed, filing the first thread's turns under the
    // second thread's session.
    act(() => {
      result.current.newConversation();
      result.current.submit("Second question");
    });
    await waitFor(() => expect(result.current.turns[0].status).toBe("done"));

    const archived = JSON.parse(window.localStorage.getItem("owu-ask-threads") ?? "[]") as Array<{
      sessionId: string;
      turns: Array<{ question: string }>;
    }>;

    expect(archived).toHaveLength(2);
    const questions = archived.map((t) => t.turns[0]?.question).sort();
    expect(questions).toEqual(["First question", "Second question"]);
    expect(new Set(archived.map((t) => t.sessionId)).size).toBe(2);
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
          { ok: false, status: 429 }
        )
      )
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

  it("clearAllThreads clears turns, bumps sessionGen, and DELETEs the server session", async () => {
    const fetchSpy = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/ask/session")) {
        if (init?.method === "DELETE") {
          return Promise.resolve(makeJsonResponse(null, { ok: true, status: 204 }));
        }
        return Promise.resolve(makeJsonResponse({ turns: [], expired: false }));
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
      result.current.clearAllThreads();
    });
    expect(result.current.turns).toEqual([]);
    expect(result.current.sessionGen).toBe(genBefore + 1);
    // Best-effort DELETE fires against the session route.
    const deleteCall = fetchSpy.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "DELETE"
    );
    expect(deleteCall).toBeDefined();
    expect(String(deleteCall?.[0])).toContain("/api/ask/session?sessionId=");
  });

  it("clearAllThreads empties the sidebar archive and DELETEs every session it held", async () => {
    const archivedSession = "archived-session-9";
    window.localStorage.setItem("owu-ask-session-id", "current-session-9");
    window.localStorage.setItem(
      "owu-ask-threads",
      JSON.stringify([
        {
          sessionId: archivedSession,
          firstQuestion: "An older thread",
          turns: [
            {
              id: "a1",
              question: "An older thread",
              answer: "kept until cleared",
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
          createdAt: Date.now() - 60_000,
          lastUpdatedAt: Date.now() - 60_000,
        },
      ])
    );

    const fetchSpy = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/ask/session")) {
        if (init?.method === "DELETE") {
          return Promise.resolve(makeJsonResponse(null, { ok: true, status: 204 }));
        }
        return Promise.resolve(makeJsonResponse({ turns: [], expired: false }));
      }
      return Promise.resolve(makeJsonResponse(mockResponse));
    });
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useAskArchive());
    await waitFor(() => expect(result.current.isHydrating).toBe(false));
    await waitFor(() => expect(result.current.threads).toHaveLength(1));

    fetchSpy.mockClear();
    act(() => {
      result.current.clearAllThreads();
    });

    expect(result.current.threads).toEqual([]);
    expect(window.localStorage.getItem("owu-ask-threads")).toBe("[]");

    const deletedSessions = fetchSpy.mock.calls
      .filter(([, init]) => (init as RequestInit | undefined)?.method === "DELETE")
      .map(([url]) => String(url));
    // The archived thread's session is deleted too, not just the
    // one currently on screen.
    expect(deletedSessions.some((url) => url.includes(archivedSession))).toBe(true);
  });

  it("retry re-submits an errored turn's question as a new turn", async () => {
    // First submit errors out.
    vi.stubGlobal(
      "fetch",
      fetchRouter(makeJsonResponse({ kind: "server", message: "Boom" }, { ok: false, status: 500 }))
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

describe("stream progress reporting", () => {
  function routeStream(sse: ControlledSse) {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/api/ask/session")) {
          return Promise.resolve(makeJsonResponse({ turns: [], expired: false }));
        }
        return Promise.resolve(sse.response);
      })
    );
  }

  // The stage label is transient by design — the first answer token
  // replaces it, and so does any terminal frame. So these streams stay
  // open: closing one would settle the turn and clear the label before
  // the assertion could read it.
  async function mountWithOpenStream(sse: ControlledSse, question: string) {
    routeStream(sse);
    const view = renderHook(() => useAskArchive());
    await waitFor(() => expect(view.result.current.isHydrating).toBe(false));
    await act(async () => {
      view.result.current.submit(question);
    });
    return view;
  }

  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("labels every stage the server actually emits, including coverage", async () => {
    const stages = [
      { name: "reformulate", label: "Understanding your question…" },
      { name: "coverage", label: "Checking archive coverage…" },
      { name: "retrieve", label: "Searching the archive…" },
      { name: "rerank", label: "Ranking sources…" },
      { name: "generate", label: "Writing answer…" },
      { name: "agent", label: "Researching…" },
    ];

    for (const stage of stages) {
      const sse = makeSseResponse();
      const view = await mountWithOpenStream(sse, `stage ${stage.name}`);
      await act(async () => {
        sse.emit({ type: "stage", name: stage.name, elapsedMs: 1 });
      });
      await waitFor(() => {
        expect(view.result.current.turns.at(-1)?.stage).toBe(stage.label);
      });
      view.unmount();
    }
  });

  it("names the archive lookups an agent turn is making", async () => {
    const sse = makeSseResponse();
    const view = await mountWithOpenStream(sse, "what did students say about curfews?");

    await act(async () => {
      sse.emit({ type: "stage", name: "agent", elapsedMs: 1 });
      sse.emit({ type: "tool_call", tool: "search_archive", round: 1, args: { query: "dorm curfew" } });
    });

    await waitFor(() => {
      expect(view.result.current.turns.at(-1)?.stage).toBe("Searching for “dorm curfew”…");
    });
    view.unmount();
  });

  it("shows what each archive lookup came back with", async () => {
    const sse = makeSseResponse();
    const view = await mountWithOpenStream(sse, "how many editions mention the fire?");

    await act(async () => {
      sse.emit({ type: "tool_call", tool: "search_archive", round: 1, args: { query: "fire" } });
      sse.emit({ type: "tool_result", tool: "search_archive", round: 1, summary: "Found 4 articles" });
    });

    await waitFor(() => {
      expect(view.result.current.turns.at(-1)?.stage).toBe("Found 4 articles");
    });
    view.unmount();
  });

  it("carries a mid-stream rate limit and its wait to the turn", async () => {
    const sse = makeSseResponse();
    const view = await mountWithOpenStream(sse, "quota please");

    await act(async () => {
      sse.emit({ type: "stage", name: "retrieve", elapsedMs: 1 });
      sse.emit({
        type: "error",
        kind: "rate_limit",
        stage: "generate",
        message: "AI quota reached. Please try again later.",
        requestId: "req-1",
        retryAfterSec: 42,
      });
      sse.close();
    });

    await waitFor(() => {
      const turn = view.result.current.turns.at(-1);
      expect(turn?.status).toBe("error");
      expect(turn?.errorKind).toBe("rate_limit");
      expect(turn?.retryAfterSec).toBe(42);
    });
    view.unmount();
  });
});

/**
 * Turn lifecycle: every way a stream can end without a `done` frame.
 *
 * "streaming" is the status that disables the composer, Export and
 * Clear-all, so a turn stuck in it is the "halts" symptom — the page
 * looks alive and accepts nothing until a reload. These tests drive the
 * reader by hand (see support/sse-response) because the bugs live in the
 * windows between reads.
 */
describe("useAskArchive turn lifecycle", () => {
  interface Recorded {
    signal: AbortSignal | undefined;
  }

  function routeStream(sse: ControlledSse, recorded: Recorded[] = []) {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/api/ask/session")) {
          return Promise.resolve(makeJsonResponse({ turns: [], expired: false }));
        }
        recorded.push({ signal: init?.signal ?? undefined });
        return Promise.resolve(sse.response);
      })
    );
    return recorded;
  }

  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function submitAndStream(sse: ControlledSse, question: string) {
    const recorded = routeStream(sse);
    const view = renderHook(() => useAskArchive());
    await waitFor(() => expect(view.result.current.isHydrating).toBe(false));
    await act(async () => {
      view.result.current.submit(question);
    });
    await waitFor(() => expect(recorded).toHaveLength(1));
    return { view, recorded };
  }

  it("settles a turn whose stream ends without done or error", async () => {
    const sse = makeSseResponse();
    const { view } = await submitAndStream(sse, "who closed the observatory?");

    await act(async () => {
      sse.emit({ type: "stage", name: "retrieve", elapsedMs: 5 });
    });
    await waitFor(() => expect(view.result.current.turns[0].stage).toBeTruthy());
    expect(view.result.current.turns[0].status).toBe("streaming");

    // The connection drops: the body ends, no terminal frame arrives.
    await act(async () => {
      sse.close();
    });

    await waitFor(() => expect(view.result.current.turns[0].status).toBe("error"));
    expect(view.result.current.turns[0].errorKind).toBe("network");
    expect(view.result.current.turns[0].errorMessage).toMatch(/connection closed/i);
  });

  it("stop() freezes the turn as stopped and keeps the words that arrived", async () => {
    const sse = makeSseResponse();
    const { view } = await submitAndStream(sse, "what did the trustees decide?");

    await act(async () => {
      sse.emit({ type: "delta", text: "The trustees voted in favour of " });
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    expect(view.result.current.turns[0].answer.length).toBeGreaterThan(0);

    act(() => {
      view.result.current.stop();
    });

    expect(view.result.current.turns[0].status).toBe("stopped");
    expect("The trustees voted in favour of ").toContain(view.result.current.turns[0].answer);
    expect(view.result.current.turns[0].stage).toBeUndefined();
  });

  it("a later done frame cannot revive a stopped turn", async () => {
    const sse = makeSseResponse();
    const { view } = await submitAndStream(sse, "and the vote after that?");

    await act(async () => {
      sse.emit({ type: "delta", text: "Partial " });
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    act(() => {
      view.result.current.stop();
    });
    expect(view.result.current.turns[0].status).toBe("stopped");
    const stoppedAnswer = view.result.current.turns[0].answer;

    // A frame already in flight when the reader hit Stop.
    await act(async () => {
      sse.emit({
        type: "done",
        answer: "The complete answer nobody asked to finish.",
        citations: [],
        confidence: "high",
        outcome: "answered",
        sessionId: "s-1",
        requestId: "r-1",
        meta: mockResponse.meta,
      });
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    expect(view.result.current.turns[0].status).toBe("stopped");
    expect(view.result.current.turns[0].answer).toBe(stoppedAnswer);
  });

  it("asking something else freezes the abandoned answer as stopped", async () => {
    const sse = makeSseResponse();
    const { view } = await submitAndStream(sse, "first question");

    await act(async () => {
      sse.emit({ type: "delta", text: "Beginning of an answer " });
      await new Promise((resolve) => setTimeout(resolve, 60));
    });

    await act(async () => {
      view.result.current.submit("second question");
    });

    expect(view.result.current.turns).toHaveLength(2);
    expect(view.result.current.turns[0].status).toBe("stopped");
    expect(view.result.current.turns[0].answer.length).toBeGreaterThan(0);
    expect(view.result.current.turns[1].status).toBe("streaming");
  });

  it("archives an abandoned answer as stopped, never as streaming", async () => {
    window.localStorage.setItem(
      "owu-ask-threads",
      JSON.stringify([
        {
          sessionId: "other-thread",
          firstQuestion: "an older question",
          turns: [
            {
              id: "old-1",
              question: "an older question",
              answer: "an older answer",
              status: "done",
              sourceArticles: [],
              citations: [],
              meta: null,
              confidence: "medium",
              requestId: "",
              mode: "text",
              createdAt: Date.now(),
            },
          ],
          createdAt: Date.now(),
          lastUpdatedAt: Date.now(),
        },
      ])
    );

    const sse = makeSseResponse();
    const { view } = await submitAndStream(sse, "leaving this one unfinished");
    await act(async () => {
      sse.emit({ type: "delta", text: "Half of an answer " });
      await new Promise((resolve) => setTimeout(resolve, 60));
    });

    await act(async () => {
      view.result.current.switchThread("other-thread");
    });

    const stored = JSON.parse(window.localStorage.getItem("owu-ask-threads") ?? "[]") as Array<{
      turns: Array<{ status: string; answer: string }>;
    }>;
    const statuses = stored.flatMap((thread) => thread.turns.map((turn) => turn.status));
    expect(statuses).not.toContain("streaming");
    expect(statuses).toContain("stopped");
    const abandoned = stored.flatMap((t) => t.turns).find((t) => t.status === "stopped");
    expect(abandoned?.answer.length).toBeGreaterThan(0);
  });

  it("heals an archive an earlier version poisoned with a streaming turn", async () => {
    const bricked = {
      sessionId: "bricked",
      firstQuestion: "stuck question",
      turns: [
        {
          id: "stuck-1",
          question: "stuck question",
          answer: "answer that never finished",
          status: "streaming",
          stage: "Writing answer…",
          sourceArticles: [],
          citations: [],
          meta: null,
          confidence: "medium",
          requestId: "",
          mode: "text",
          createdAt: Date.now(),
        },
      ],
      createdAt: Date.now(),
      lastUpdatedAt: Date.now(),
    };
    window.localStorage.setItem("owu-ask-threads", JSON.stringify([bricked]));
    window.localStorage.setItem("owu-ask-session-id", "bricked");

    const sse = makeSseResponse();
    routeStream(sse);
    const view = renderHook(() => useAskArchive());
    await waitFor(() => expect(view.result.current.isHydrating).toBe(false));

    // The repair is written back, not merely applied in memory.
    const stored = JSON.parse(window.localStorage.getItem("owu-ask-threads") ?? "[]") as Array<{
      turns: Array<{ status: string; stage?: string }>;
    }>;
    expect(stored[0].turns[0].status).toBe("stopped");
    expect(stored[0].turns[0].stage).toBeUndefined();
    view.unmount();
  });

  it("reading a thread leaves its sidebar position and timestamp alone", async () => {
    const ONE_HOUR = 60 * 60 * 1000;
    const openedAt = Date.now() - 3 * ONE_HOUR;
    const newerAt = Date.now() - ONE_HOUR;
    const storedTurn = {
      id: "archived-1",
      question: "who ran the observatory?",
      answer: "Professor Perkins ran it from 1952.",
      status: "done",
      sourceArticles: [],
      citations: [],
      meta: null,
      confidence: "medium",
      requestId: "",
      mode: "text",
      createdAt: openedAt,
    };
    window.localStorage.setItem(
      "owu-ask-threads",
      JSON.stringify([
        {
          sessionId: "opened",
          firstQuestion: storedTurn.question,
          turns: [storedTurn],
          createdAt: openedAt,
          lastUpdatedAt: openedAt,
        },
        {
          sessionId: "newer",
          firstQuestion: "a more recent question",
          turns: [{ ...storedTurn, id: "archived-2", question: "a more recent question" }],
          createdAt: newerAt,
          lastUpdatedAt: newerAt,
        },
      ])
    );
    window.localStorage.setItem("owu-ask-session-id", "opened");

    // The session API returns the same turn the archive holds, which is
    // what the persist effect then sees.
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/api/ask/session")) {
          return Promise.resolve(
            makeJsonResponse({
              turns: [
                {
                  question: storedTurn.question,
                  answer: storedTurn.answer,
                  citedArticleIds: [],
                  timestamp: openedAt,
                },
              ],
              expired: false,
            })
          );
        }
        throw new Error(`unexpected fetch: ${url}`);
      })
    );

    const view = renderHook(() => useAskArchive());
    await waitFor(() => expect(view.result.current.turns).toHaveLength(1));
    // Let the persist effect run.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const stored = JSON.parse(window.localStorage.getItem("owu-ask-threads") ?? "[]") as Array<{
      sessionId: string;
      lastUpdatedAt: number;
    }>;
    expect(stored.find((t) => t.sessionId === "opened")?.lastUpdatedAt).toBe(openedAt);
    // And the sidebar still lists the genuinely newer thread first.
    expect(view.result.current.threads.map((t) => t.id)).toEqual(["newer", "opened"]);
    view.unmount();
  });

  it("a click on a thread that is gone leaves the live answer running", async () => {
    const sse = makeSseResponse();
    const { view } = await submitAndStream(sse, "keep answering this");
    await act(async () => {
      sse.emit({ type: "delta", text: "Still writing " });
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    const partial = view.result.current.turns[0].answer;
    expect(view.result.current.turns[0].status).toBe("streaming");

    await act(async () => {
      view.result.current.switchThread("a-thread-that-aged-out");
    });

    // Nowhere to go, so nothing is spent: the answer keeps arriving.
    expect(view.result.current.turns[0].status).toBe("streaming");
    expect(view.result.current.threads).toEqual([]);
    await act(async () => {
      sse.emit({ type: "delta", text: "and finishing." });
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    expect(view.result.current.turns[0].answer.length).toBeGreaterThan(partial.length);
    view.unmount();
  });

  it("settles hydration even when no session id can be minted", async () => {
    // No CSPRNG: readOrCreateSessionId returns "". The effect used to
    // return here without dispatching, leaving isHydrating raised — the
    // composer, Export and Clear-all stayed disabled for the whole
    // visit, so the page could not be used at all.
    const realCrypto = window.crypto;
    Object.defineProperty(window, "crypto", { value: undefined, configurable: true });
    try {
      vi.stubGlobal(
        "fetch",
        vi.fn(() => {
          throw new Error("no session id means no session fetch");
        })
      );
      const view = renderHook(() => useAskArchive());
      await waitFor(() => expect(view.result.current.isHydrating).toBe(false));
      expect(view.result.current.turns).toEqual([]);
      expect(view.result.current.expiredBanner).toBe(false);
      view.unmount();
    } finally {
      Object.defineProperty(window, "crypto", { value: realCrypto, configurable: true });
    }
  });

  it("aborts an in-flight answer when the workspace unmounts", async () => {
    const sse = makeSseResponse();
    const recorded: Recorded[] = [];
    routeStream(sse, recorded);
    const view = renderHook(() => useAskArchive());
    await waitFor(() => expect(view.result.current.isHydrating).toBe(false));
    await act(async () => {
      view.result.current.submit("leaving mid-answer");
    });
    await waitFor(() => expect(recorded).toHaveLength(1));
    expect(recorded[0].signal?.aborted).toBe(false);

    view.unmount();

    expect(recorded[0].signal?.aborted).toBe(true);
  });
});
