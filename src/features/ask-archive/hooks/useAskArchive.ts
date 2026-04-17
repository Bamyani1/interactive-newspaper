"use client";

import { useReducer, useRef, useCallback, useEffect } from "react";
import type { AskResponse, AskErrorKind } from "@/src/types";
import { askReducer, INITIAL_STATE, type Turn } from "./askReducer";

// Session id persists in localStorage so a reload rehydrates the same
// conversation from /api/ask/session.
const SESSION_STORAGE_KEY = "owu-ask-session-id";

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
    submit: (question: string) => void;
    retry: (turnId: string) => void;
    newConversation: () => void;
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

        let cancelled = false;
        (async () => {
            dispatch({ type: "HYDRATING" });
            try {
                const res = await fetch(
                    `/api/ask/session?sessionId=${encodeURIComponent(sessionId)}`,
                );
                if (!res.ok) {
                    dispatch({
                        type: "HYDRATE",
                        turns: [],
                        expired: false,
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
                const turns: Turn[] = (json.turns ?? []).map((t, i) => ({
                    id: `hydrated-${t.timestamp}-${i}`,
                    question: t.question,
                    answer: t.answer,
                    status: "done" as const,
                    sourceArticles: t.sourceArticles ?? [],
                    citations: [],
                    meta: null,
                    confidence: "medium" as const,
                    requestId: "",
                    mode: "text" as const,
                    createdAt: t.timestamp,
                }));
                dispatch({
                    type: "HYDRATE",
                    turns,
                    expired: Boolean(json.expired),
                });
            } catch {
                if (!cancelled) {
                    dispatch({
                        type: "HYDRATE",
                        turns: [],
                        expired: false,
                    });
                }
            }
        })();
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
                            dispatch({
                                type: "TURN_DELTA",
                                id: turnId,
                                text: event.text,
                            });
                        } else if (event.type === "done") {
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

    const newConversation = useCallback(() => {
        abortRef.current?.abort();
        if (typeof window !== "undefined") {
            try {
                window.localStorage.removeItem(SESSION_STORAGE_KEY);
            } catch {
                // localStorage disabled; nothing to remove.
            }
        }
        sessionIdRef.current = null;
        // Mint a fresh id eagerly so the next hydrate/submit uses it.
        sessionIdRef.current = readOrCreateSessionId();
        dispatch({ type: "NEW_CONVERSATION" });
    }, [dispatch]);

    return {
        turns: state.turns,
        isHydrating: state.isHydrating,
        expiredBanner: state.expiredBanner,
        sessionGen: state.sessionGen,
        submit,
        retry,
        newConversation,
    };
}
