"use client";

import { useState, useRef, useCallback } from "react";
import type { AskResponse } from "@/src/types";

export type AskStage = "reformulate" | "embed" | "retrieve" | "rerank" | "generate" | "agent";

export interface FeedEntry {
  id: string;
  text: string;
  type: "query" | "tool" | "result" | "status";
}

interface UseAskArchiveReturn {
  answer: AskResponse | null;
  isStreaming: boolean;
  stage: AskStage | null;
  isLoading: boolean;
  error: string | null;
  feedEntries: FeedEntry[];
  submit: (question: string) => void;
  reset: () => void;
  /**
   * Start a fresh conversation — mints a new sessionId so follow-up
   * questions no longer carry prior context into the reformulator.
   */
  newConversation: () => void;
}

// localStorage key under which the current conversation's sessionId
// is kept. Same tab → same session across page reloads.
const SESSION_STORAGE_KEY = "owu-ask-session-id";

function readOrCreateSessionId(): string {
  if (typeof window === "undefined") return "";
  try {
    const existing = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (existing) return existing;
    const fresh =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36);
    window.localStorage.setItem(SESSION_STORAGE_KEY, fresh);
    return fresh;
  } catch {
    // localStorage can throw (private mode, disabled storage). Fall
    // back to an in-memory id — we just lose persistence across reloads.
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

// Discriminated union of SSE event shapes from /api/ask?stream=1
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
  | { type: "tool_call"; tool: string; round: number; args?: Record<string, unknown> }
  | { type: "tool_result"; tool: string; round: number; summary?: string }
  | {
      type: "error";
      stage?: string;
      cause?: string;
      message: string;
      requestId?: string;
    };

/**
 * Parse an SSE data frame buffer into one event (or null if malformed).
 * Frames are formatted as `data: {json}\n\n`.
 */
function parseEventFrame(frame: string): StreamEvent | null {
  const trimmed = frame.trim();
  if (!trimmed) return null;
  // Avoid the /s (dotall) flag for ES2017 targets by using [\s\S].
  const match = trimmed.match(/^data:\s*([\s\S]*)$/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]) as StreamEvent;
  } catch {
    return null;
  }
}

export function useAskArchive(): UseAskArchiveReturn {
  const [answer, setAnswer] = useState<AskResponse | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [stage, setStage] = useState<AskStage | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedEntries, setFeedEntries] = useState<FeedEntry[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const feedIdRef = useRef(0);
  const feedRef = useRef<FeedEntry[]>([]);
  // Session id is lazy-initialized on first submit, not at mount, so
  // SSR/hydration doesn't clash with localStorage access.
  const sessionIdRef = useRef<string | null>(null);

  const submit = useCallback((question: string) => {
    const trimmed = question.trim();
    if (!trimmed) return;

    // Abort any in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    setError(null);
    setAnswer(null);
    setIsStreaming(false);
    setStage(null);
    feedRef.current = [];
    setFeedEntries([]);

    // Lazily ensure a session id exists for this tab; reuse across
    // submits so the server's conversation-store links turns together.
    if (!sessionIdRef.current) {
      sessionIdRef.current = readOrCreateSessionId();
    }
    const sessionId = sessionIdRef.current;

    // Runs the streaming request in a closure so we can use async/await
    // without exposing submit() as async (React callback semantics).
    (async () => {
      try {
        const res = await fetch("/api/ask?stream=1", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: trimmed, sessionId }),
          signal: controller.signal,
        });

        if (!res.ok) {
          // Non-2xx: validation / rate-limit / auth errors are returned as JSON,
          // not as an SSE stream. Parse and throw.
          const body = await res.json().catch(() => null);
          throw new Error(body?.error || `Request failed: ${res.status}`);
        }

        const contentType = res.headers.get("content-type") || "";
        if (!contentType.includes("text/event-stream") || !res.body) {
          // Server didn't return a stream — fall back to JSON shape so the
          // hook still works if streaming is disabled server-side.
          const data = (await res.json()) as AskResponse;
          if (!controller.signal.aborted) {
            setAnswer(data);
            setStage(null);
            setIsStreaming(false);
          }
          return;
        }

        // Placeholder response that gets progressively populated as events
        // arrive. Non-streaming consumers (old UI, tests) never see this
        // intermediate shape because they await the done event.
        // requestId is filled in when the metadata event arrives; until
        // then it's an empty string so the feedback button stays disabled.
        let pending: AskResponse = {
          question: trimmed,
          answer: "",
          citations: [],
          confidence: "low",
          mode: "text",
          requestId: "",
          sourceArticles: [],
          meta: {
            retrievalTimeMs: 0,
            generationTimeMs: 0,
            totalTimeMs: 0,
            articlesSearched: 0,
            method: "hybrid",
          },
        };

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        const addFeed = (text: string, type: FeedEntry["type"]) => {
          feedIdRef.current++;
          const entry: FeedEntry = { id: `fe-${feedIdRef.current}`, text, type };
          feedRef.current = [...feedRef.current, entry];
          setFeedEntries(feedRef.current);
        };

        while (true) {
          const { done, value } = await reader.read();
          if (value) buf += decoder.decode(value, { stream: true });
          // Split complete frames; keep any trailing partial frame in `buf`.
          let sepIdx = buf.indexOf("\n\n");
          while (sepIdx !== -1) {
            const frame = buf.slice(0, sepIdx);
            buf = buf.slice(sepIdx + 2);
            const event = parseEventFrame(frame);
            if (event && !controller.signal.aborted) {
              if (event.type === "stage") {
                setStage(event.name);
                if (event.name === "reformulate" && event.detail) {
                  addFeed(`Searching for: \u201c${event.detail}\u201d`, "query");
                } else if (event.name === "retrieve") {
                  addFeed("Searching the archive\u2026", "status");
                } else if (event.name === "rerank") {
                  addFeed("Ranking by relevance\u2026", "status");
                } else if (event.name === "generate") {
                  addFeed("Writing answer\u2026", "status");
                } else if (event.name === "agent") {
                  addFeed("Researching your question\u2026", "status");
                }
              } else if (event.type === "metadata") {
                pending = {
                  ...pending,
                  mode: event.mode,
                  requestId: event.requestId,
                  sourceArticles: event.sourceArticles,
                  meta: { ...pending.meta, ...event.meta },
                };
                setAnswer(pending);
                setStage("generate");
                setIsStreaming(true);
              } else if (event.type === "tool_call") {
                setStage("agent" as AskStage);
                if (event.tool === "search_archive" && event.args?.query) {
                  addFeed(`Searching archive for \u2018${event.args.query}\u2019\u2026`, "tool");
                } else if (event.tool === "read_article" && event.args?.articleId) {
                  addFeed(`Reading article ${event.args.articleId}\u2026`, "tool");
                } else if (event.tool === "list_editions") {
                  addFeed("Checking available editions\u2026", "tool");
                } else {
                  addFeed("Researching\u2026", "tool");
                }
              } else if (event.type === "tool_result") {
                if (event.summary) {
                  addFeed(event.summary, "result");
                }
              } else if (event.type === "delta") {
                pending = { ...pending, answer: pending.answer + event.text };
                setAnswer(pending);
              } else if (event.type === "done") {
                pending = {
                  ...pending,
                  answer: event.answer,
                  citations: event.citations,
                  confidence: event.confidence,
                  meta: event.meta,
                  ...(event.sourceArticles ? { sourceArticles: event.sourceArticles } : {}),
                  ...(event.sessionId ? { sessionId: event.sessionId } : {}),
                  ...(event.followUpQuestions ? { followUpQuestions: event.followUpQuestions } : {}),
                };
                setAnswer(pending);
                setIsStreaming(false);
                setStage(null);
              } else if (event.type === "error") {
                throw new Error(event.message || "Request failed");
              }
            }
            sepIdx = buf.indexOf("\n\n");
          }
          if (done) break;
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "Something went wrong");
          setIsStreaming(false);
        }
      } finally {
        // Always clear loading — if a newer request is already in flight,
        // it will have set isLoading=true before this finally runs.
        setIsLoading(false);
      }
    })();
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setAnswer(null);
    setIsStreaming(false);
    setStage(null);
    setError(null);
    setIsLoading(false);
    feedRef.current = [];
    setFeedEntries([]);
  }, []);

  const newConversation = useCallback(() => {
    // Drop the persisted id so the next submit gets a fresh session.
    // Also clear the visible state so the UI reads as "starting over".
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(SESSION_STORAGE_KEY);
      } catch {
        // localStorage disabled; nothing to remove.
      }
    }
    sessionIdRef.current = null;
    reset();
  }, [reset]);

  return { answer, isStreaming, stage, isLoading, error, feedEntries, submit, reset, newConversation };
}
