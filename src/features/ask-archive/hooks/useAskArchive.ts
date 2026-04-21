"use client";

import { useReducer, useRef, useCallback, useEffect } from "react";
import type { AskResponse, AskErrorKind } from "@/src/types";
import {
    askReducer,
    INITIAL_STATE,
    type Turn,
    type EmptyReason,
    type ThreadSummary,
} from "./askReducer";

// Session id persists in localStorage so a reload rehydrates the same
// conversation from /api/ask/session.
const SESSION_STORAGE_KEY = "owu-ask-session-id";

// Multi-thread archive. Each entry is a full serialized thread keyed
// by its sessionId; the user browses threads from the sidebar, and
// `switchThread` round-trips through this archive. localStorage is
// intentional — we want threads to outlive the 30-min server TTL.
const THREADS_STORAGE_KEY = "owu-ask-threads";

interface StoredThread {
    sessionId: string;
    firstQuestion: string;
    turns: Turn[];
    createdAt: number;
    lastUpdatedAt: number;
}

function readArchive(): StoredThread[] {
    if (typeof window === "undefined") return [];
    try {
        const raw = window.localStorage.getItem(THREADS_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw) as StoredThread[];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function writeArchive(threads: StoredThread[]): void {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(
            THREADS_STORAGE_KEY,
            JSON.stringify(threads),
        );
    } catch {
        // Quota exceeded or storage disabled — silently skip. The
        // active thread's turns still live in the reducer, so the
        // user doesn't lose their live conversation.
    }
}

function upsertArchive(sessionId: string, turns: Turn[]): StoredThread[] {
    // Empty threads don't earn a sidebar slot — keeps the list from
    // filling up with abandoned starts.
    if (turns.length === 0) return readArchive();
    const archive = readArchive();
    const now = Date.now();
    const firstQuestion = turns[0].question;
    const idx = archive.findIndex((t) => t.sessionId === sessionId);
    const entry: StoredThread = {
        sessionId,
        firstQuestion,
        turns,
        createdAt: idx >= 0 ? archive[idx].createdAt : now,
        lastUpdatedAt: now,
    };
    const next = [...archive];
    if (idx >= 0) next[idx] = entry;
    else next.push(entry);
    writeArchive(next);
    return next;
}

function removeFromArchive(sessionId: string): StoredThread[] {
    const archive = readArchive();
    const next = archive.filter((t) => t.sessionId !== sessionId);
    writeArchive(next);
    return next;
}

function toSummary(entry: StoredThread): ThreadSummary {
    return {
        id: entry.sessionId,
        firstQuestion: entry.firstQuestion,
        turnCount: entry.turns.length,
        lastUpdatedAt: entry.lastUpdatedAt,
    };
}

function summariesFrom(archive: StoredThread[]): ThreadSummary[] {
    return archive
        .map(toSummary)
        // Most-recent first so the sidebar reads like a chat history.
        .sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt);
}

// ── Shape of SSE events the /api/ask?stream=1 endpoint emits. ──
export type AskStage =
    | "reformulate"
    | "embed"
    | "retrieve"
    | "rerank"
    | "generate"
    | "agent";

type StreamEvent =
    | { type: "stage"; name: AskStage; elapsedMs: number; detail?: string }
    | {
          type: "metadata";
          question: string;
          mode: "text" | "visual";
          requestId: string;
          sourceArticles: AskResponse["sourceArticles"];
          meta: Partial<AskResponse["meta"]>;
      }
    | { type: "delta"; text: string }
    | {
          type: "done";
          answer: string;
          citations: AskResponse["citations"];
          confidence: AskResponse["confidence"];
          sourceArticles?: AskResponse["sourceArticles"];
          sessionId?: string;
          followUpQuestions?: string[];
          meta: AskResponse["meta"];
      }
    | {
          type: "tool_call";
          tool: string;
          round: number;
          args?: Record<string, unknown>;
      }
    | {
          type: "tool_result";
          tool: string;
          round: number;
          summary?: string;
      }
    | {
          type: "error";
          stage?: string;
          cause?: string;
          kind?: AskErrorKind;
          message: string;
          requestId?: string;
      };

// When the backend answer arrives as one payload (agent path + cache path
// both emit a single `done` event instead of per-token deltas), replay it
// as a stream of small chunks so the reader still sees words appearing.
// Purely presentation-layer — no pipeline or network change.
async function replayAnswerAsDeltas(
    id: string,
    answer: string,
    dispatch: (action: {
        type: "TURN_DELTA";
        id: string;
        text: string;
    }) => void,
    signal: AbortSignal,
): Promise<void> {
    const tokens = answer.split(/(\s+)/);
    const chunkSize = 2;
    const chunkDelay = 16;
    for (let i = 0; i < tokens.length; i += chunkSize) {
        if (signal.aborted) return;
        const text = tokens.slice(i, i + chunkSize).join("");
        if (text.length > 0) {
            dispatch({ type: "TURN_DELTA", id, text });
        }
        if (i + chunkSize < tokens.length) {
            await new Promise((resolve) => setTimeout(resolve, chunkDelay));
        }
    }
}

function parseEventFrame(frame: string): StreamEvent | null {
    const trimmed = frame.trim();
    if (!trimmed) return null;
    const match = trimmed.match(/^data:\s*([\s\S]*)$/);
    if (!match) return null;
    try {
        return JSON.parse(match[1]) as StreamEvent;
    } catch {
        return null;
    }
}

function readOrCreateSessionId(): string {
    if (typeof window === "undefined") return "";
    try {
        const existing = window.localStorage.getItem(SESSION_STORAGE_KEY);
        if (existing) return existing;
        const fresh =
            typeof crypto !== "undefined" &&
            typeof crypto.randomUUID === "function"
                ? crypto.randomUUID()
                : Math.random().toString(36).slice(2) +
                  Date.now().toString(36);
        window.localStorage.setItem(SESSION_STORAGE_KEY, fresh);
        return fresh;
    } catch {
        return (
            Math.random().toString(36).slice(2) + Date.now().toString(36)
        );
    }
}

function newTurnId(): string {
    return `turn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function errorKindFromStatus(status: number): AskErrorKind {
    if (status === 429) return "rate_limit";
    if (status === 504) return "timeout";
    if (status === 400) return "bad_request";
    if (status === 502 || status === 503 || status >= 500) return "server";
    return "server";
}

interface StageDisplay {
    label: string;
}
function stageDisplay(name?: AskStage): StageDisplay | null {
    if (!name) return null;
    switch (name) {
        case "reformulate":
            return { label: "Thinking…" };
        case "embed":
            return { label: "Searching archive…" };
        case "retrieve":
            return { label: "Searching archive…" };
        case "rerank":
            return { label: "Ranking sources…" };
        case "generate":
            return { label: "Writing answer…" };
        case "agent":
            return { label: "Researching…" };
        default:
            return null;
    }
}

export interface UseAskArchiveReturn {
    turns: Turn[];
    isHydrating: boolean;
    expiredBanner: boolean;
    sessionGen: number;
    emptyReason: EmptyReason;
    threads: ThreadSummary[];
    activeThreadId: string | null;
    submit: (question: string) => void;
    retry: (turnId: string) => void;
    clearConversation: () => void;
    newConversation: () => void;
    switchThread: (threadId: string) => void;
}

export function useAskArchive(): UseAskArchiveReturn {
    const [state, dispatch] = useReducer(askReducer, INITIAL_STATE);
    const abortRef = useRef<AbortController | null>(null);
    const sessionIdRef = useRef<string | null>(null);

    // ── Hydrate on mount ──
    useEffect(() => {
        if (typeof window === "undefined") return;
        const sessionId = readOrCreateSessionId();
        sessionIdRef.current = sessionId;
        if (!sessionId) return;

        // Read archived threads from localStorage — survives server
        // TTL and gives the sidebar something to show immediately.
        const archive = readArchive();
        const archivedActive = archive.find(
            (t) => t.sessionId === sessionId,
        );
        const summaries = summariesFrom(archive);

        let cancelled = false;
        const run = async () => {
            dispatch({ type: "HYDRATING" });
            try {
                const res = await fetch(
                    `/api/ask/session?sessionId=${encodeURIComponent(sessionId)}`,
                );
                if (!res.ok) {
                    // Fall back to local archive — the server may have
                    // dropped the session but we still have turns in
                    // localStorage.
                    dispatch({
                        type: "HYDRATE",
                        turns: archivedActive?.turns ?? [],
                        expired: false,
                        threads: summaries,
                        activeThreadId: sessionId,
                    });
                    return;
                }
                const json = (await res.json()) as {
                    turns?: Array<{
                        question: string;
                        answer: string;
                        citedArticleIds: string[];
                        sourceArticles?: AskResponse["sourceArticles"];
                        timestamp: number;
                    }>;
                    expired?: boolean;
                };
                if (cancelled) return;
                // The session API doesn't persist mode/confidence/meta, but
                // localStorage does. When a local turn aligns with a
                // server turn (same position + same question), recover
                // those fields so the visual-mode photos panel, the
                // confidence badge, and the answer meta survive a
                // reload. Position-matching is safe because both the
                // reducer and the server store turns in strict order.
                const localTurns = archivedActive?.turns ?? [];
                const serverTurns: Turn[] = (json.turns ?? []).map((t, i) => {
                    const local =
                        localTurns[i]?.question === t.question
                            ? localTurns[i]
                            : undefined;
                    return {
                        id: `hydrated-${t.timestamp}-${i}`,
                        question: t.question,
                        answer: t.answer,
                        status: "done" as const,
                        sourceArticles:
                            t.sourceArticles ?? local?.sourceArticles ?? [],
                        citations: local?.citations ?? [],
                        meta: local?.meta ?? null,
                        confidence: local?.confidence ?? "medium",
                        requestId: local?.requestId ?? "",
                        mode: local?.mode ?? "text",
                        createdAt: t.timestamp,
                    };
                });
                // Prefer server turns when present (most recent); fall
                // through to the local archive if server reports empty
                // but we have a stored thread for this sessionId.
                const turns =
                    serverTurns.length > 0
                        ? serverTurns
                        : archivedActive?.turns ?? [];
                dispatch({
                    type: "HYDRATE",
                    turns,
                    expired: Boolean(json.expired),
                    threads: summaries,
                    activeThreadId: sessionId,
                });
            } catch {
                if (!cancelled) {
                    dispatch({
                        type: "HYDRATE",
                        turns: archivedActive?.turns ?? [],
                        expired: false,
                        threads: summaries,
                        activeThreadId: sessionId,
                    });
                }
            }
        };
        void run();
        return () => {
            cancelled = true;
        };
    }, [dispatch]);

    const streamQuestion = useCallback(
        async (turnId: string, question: string): Promise<void> => {
            abortRef.current?.abort();
            const controller = new AbortController();
            abortRef.current = controller;

            if (!sessionIdRef.current) {
                sessionIdRef.current = readOrCreateSessionId();
            }
            const sessionId = sessionIdRef.current ?? "";

            try {
                const res = await fetch("/api/ask?stream=1", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ question, sessionId }),
                    signal: controller.signal,
                });

                if (!res.ok) {
                    let body: Record<string, unknown> | null = null;
                    try {
                        body = (await res.json()) as Record<string, unknown>;
                    } catch {
                        body = null;
                    }
                    dispatch({
                        type: "TURN_ERROR",
                        id: turnId,
                        kind:
                            (body?.kind as AskErrorKind) ??
                            errorKindFromStatus(res.status),
                        message:
                            (body?.message as string) ||
                            (body?.error as string) ||
                            `Request failed (${res.status})`,
                        retryAfterSec: body?.retryAfterSec as number | undefined,
                    });
                    return;
                }

                const contentType = res.headers.get("content-type") ?? "";
                if (!contentType.includes("text/event-stream") || !res.body) {
                    // Non-streaming fallback — parse JSON and mark turn done.
                    const data = (await res.json()) as AskResponse;
                    dispatch({
                        type: "TURN_META",
                        id: turnId,
                        mode: data.mode,
                        requestId: data.requestId,
                        sourceArticles: data.sourceArticles,
                        meta: data.meta,
                    });
                    dispatch({
                        type: "TURN_DONE",
                        id: turnId,
                        answer: data.answer,
                        citations: data.citations,
                        confidence: data.confidence,
                        meta: data.meta,
                        sourceArticles: data.sourceArticles,
                        followUpQuestions: data.followUpQuestions,
                    });
                    return;
                }

                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let buf = "";
                // Track whether we've seen any delta events. If `done`
                // fires without any preceding deltas (agent / cache path),
                // replay the final answer as chunks so the reader sees it
                // type on instead of dump-paste.
                let receivedDelta = false;
                while (true) {
                    const { done, value } = await reader.read();
                    if (value) buf += decoder.decode(value, { stream: true });
                    let sepIdx = buf.indexOf("\n\n");
                    while (sepIdx !== -1) {
                        const frame = buf.slice(0, sepIdx);
                        buf = buf.slice(sepIdx + 2);
                        const event = parseEventFrame(frame);
                        if (!event || controller.signal.aborted) {
                            sepIdx = buf.indexOf("\n\n");
                            continue;
                        }
                        if (event.type === "stage") {
                            const disp = stageDisplay(event.name);
                            if (disp) {
                                dispatch({
                                    type: "TURN_STAGE",
                                    id: turnId,
                                    stage: disp.label,
                                });
                            }
                        } else if (event.type === "metadata") {
                            dispatch({
                                type: "TURN_META",
                                id: turnId,
                                mode: event.mode,
                                requestId: event.requestId,
                                sourceArticles: event.sourceArticles,
                                meta: event.meta,
                            });
                        } else if (event.type === "tool_call") {
                            dispatch({
                                type: "TURN_STAGE",
                                id: turnId,
                                stage: "Researching…",
                            });
                        } else if (event.type === "delta") {
                            receivedDelta = true;
                            dispatch({
                                type: "TURN_DELTA",
                                id: turnId,
                                text: event.text,
                            });
                        } else if (event.type === "done") {
                            if (!receivedDelta && event.answer) {
                                await replayAnswerAsDeltas(
                                    turnId,
                                    event.answer,
                                    dispatch,
                                    controller.signal,
                                );
                            }
                            dispatch({
                                type: "TURN_DONE",
                                id: turnId,
                                answer: event.answer,
                                citations: event.citations,
                                confidence: event.confidence,
                                meta: event.meta,
                                sourceArticles: event.sourceArticles,
                                followUpQuestions: event.followUpQuestions,
                            });
                        } else if (event.type === "error") {
                            dispatch({
                                type: "TURN_ERROR",
                                id: turnId,
                                kind: event.kind ?? "server",
                                message:
                                    event.message ||
                                    "Something went wrong. Please try again.",
                            });
                        }
                        sepIdx = buf.indexOf("\n\n");
                    }
                    if (done) break;
                }
            } catch (err) {
                if (err instanceof DOMException && err.name === "AbortError") {
                    return;
                }
                if (!controller.signal.aborted) {
                    dispatch({
                        type: "TURN_ERROR",
                        id: turnId,
                        kind: "network",
                        message: "Connection lost. Check your network and retry.",
                    });
                }
            }
        },
        [dispatch],
    );

    const submit = useCallback(
        (question: string) => {
            const trimmed = question.trim();
            if (!trimmed) return;
            const id = newTurnId();
            dispatch({
                type: "APPEND_USER",
                id,
                question: trimmed,
                createdAt: Date.now(),
            });
            void streamQuestion(id, trimmed);
        },
        [dispatch, streamQuestion],
    );

    const retry = useCallback(
        (turnId: string) => {
            // Find the errored turn by id, re-submit its question as a new
            // turn. We don't mutate the errored turn in place — the
            // transcript keeps its history honest.
            const existing = state.turns.find((t) => t.id === turnId);
            if (!existing) return;
            submit(existing.question);
        },
        [state.turns, submit],
    );

    // Mint a fresh sessionId for the next thread. Updates the ref
    // and the localStorage active-session key; never touches the
    // server. Shared by New/Clear/switchThread.
    const mintFreshSession = useCallback((): string => {
        if (typeof window !== "undefined") {
            try {
                window.localStorage.removeItem(SESSION_STORAGE_KEY);
            } catch {
                // localStorage disabled — proceed; the next call to
                // readOrCreateSessionId falls back to an in-memory id.
            }
        }
        sessionIdRef.current = null;
        const fresh = readOrCreateSessionId();
        sessionIdRef.current = fresh;
        return fresh;
    }, []);

    // DELETE the server-side session. Only called from Clear — New
    // and switchThread leave the server alone so the archived thread
    // can still reference server-side conversation context on the
    // off chance the user switches back before the 30-min TTL.
    const deleteServerSession = useCallback((sessionId: string) => {
        if (!sessionId || typeof window === "undefined") return;
        void fetch(
            `/api/ask/session?sessionId=${encodeURIComponent(sessionId)}`,
            { method: "DELETE", keepalive: true },
        ).catch(() => {
            // Best-effort; the TTL is the safety net.
        });
    }, []);

    const clearConversation = useCallback(() => {
        abortRef.current?.abort();
        const prevSessionId = sessionIdRef.current;
        // Clear is destructive: wipe the server session AND remove
        // the thread from the sidebar archive. The user is asking to
        // throw this conversation away, not park it.
        if (prevSessionId) {
            deleteServerSession(prevSessionId);
            removeFromArchive(prevSessionId);
        }
        const fresh = mintFreshSession();
        dispatch({ type: "CLEAR_CONVERSATION" });
        dispatch({
            type: "SET_THREADS",
            threads: summariesFrom(readArchive()),
            activeThreadId: fresh,
        });
    }, [dispatch, mintFreshSession, deleteServerSession]);

    const newConversation = useCallback(() => {
        abortRef.current?.abort();
        const prevSessionId = sessionIdRef.current;
        // New archives the current thread to the sidebar (so the user
        // can come back to it) and mints a fresh session for the next
        // conversation. No server DELETE — the archived thread keeps
        // its server-side context for the remainder of the TTL.
        if (prevSessionId) {
            upsertArchive(prevSessionId, state.turns);
        }
        const fresh = mintFreshSession();
        dispatch({ type: "NEW_CONVERSATION" });
        dispatch({
            type: "SET_THREADS",
            threads: summariesFrom(readArchive()),
            activeThreadId: fresh,
        });
    }, [dispatch, mintFreshSession, state.turns]);

    const switchThread = useCallback(
        (threadId: string) => {
            if (threadId === sessionIdRef.current) return; // no-op
            abortRef.current?.abort();
            // Snapshot the current thread before leaving so we don't
            // lose any turns that weren't archived yet.
            const prevSessionId = sessionIdRef.current;
            if (prevSessionId) {
                upsertArchive(prevSessionId, state.turns);
            }
            const archive = readArchive();
            const target = archive.find((t) => t.sessionId === threadId);
            if (!target) return; // gone — stale sidebar click
            sessionIdRef.current = threadId;
            if (typeof window !== "undefined") {
                try {
                    window.localStorage.setItem(
                        SESSION_STORAGE_KEY,
                        threadId,
                    );
                } catch {
                    // localStorage disabled — the ref still updated.
                }
            }
            dispatch({
                type: "SWITCH_THREAD",
                activeThreadId: threadId,
                turns: target.turns,
            });
            dispatch({
                type: "SET_THREADS",
                threads: summariesFrom(archive),
                activeThreadId: threadId,
            });
        },
        [dispatch, state.turns],
    );

    // Persist the active thread to localStorage at each stable
    // milestone — a new turn appended or the latest turn settled to
    // done/error. We skip while streaming so per-token deltas don't
    // thrash the archive. Mirrors the just-written archive back into
    // state so the sidebar reflects "N turns" live.
    const lastTurnStatus =
        state.turns[state.turns.length - 1]?.status;
    const turnCount = state.turns.length;
    useEffect(() => {
        const activeId = sessionIdRef.current;
        if (!activeId) return;
        if (turnCount === 0) return;
        if (lastTurnStatus === "streaming") return;
        const archive = upsertArchive(activeId, state.turns);
        // Mirror the just-written archive back into the reducer so the
        // sidebar summary stays live with the latest turn count.
        dispatch({
            type: "SET_THREADS",
            threads: summariesFrom(archive),
            activeThreadId: activeId,
        });
    }, [turnCount, lastTurnStatus, state.turns]);

    return {
        turns: state.turns,
        isHydrating: state.isHydrating,
        expiredBanner: state.expiredBanner,
        sessionGen: state.sessionGen,
        emptyReason: state.emptyReason,
        threads: state.threads,
        activeThreadId: state.activeThreadId,
        submit,
        retry,
        clearConversation,
        newConversation,
        switchThread,
    };
}
