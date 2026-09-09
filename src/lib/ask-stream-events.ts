/**
 * ask-stream-events — the one definition of the /api/ask SSE protocol.
 *
 * The server and the transcript client each used to declare their own
 * idea of this wire format, and they had drifted: the server emitted a
 * `coverage` stage the client did not know about and dropped on the
 * floor, the client had an `embed` stage the server stopped emitting
 * when embedding moved inside retrieval, `tool_result` was sent and
 * never read, and no error event carried the `kind` the client needed to
 * tell a rate limit from a timeout. Sharing the type makes each of those
 * a compile error instead of a silent mismatch.
 *
 * Client-safe by construction: types only, two pure functions, and no
 * import that reaches a server module.
 */

import type { AskErrorKind, AskResponse } from "@/src/types";

export type { AskErrorKind };

/**
 * Pipeline steps the server announces as it works. `embed` is absent on
 * purpose: the query embedding runs inside `retrieve`, concurrently with
 * the lexical search, so it has no separately observable moment.
 */
export type AskStage = "reformulate" | "coverage" | "retrieve" | "rerank" | "generate" | "agent";

/**
 * Where an error was raised. The `*-retry` stages come from the
 * corrective-retrieval pass, which re-runs earlier steps with a broader
 * query, so a failure there is not the same as a failure first time
 * round.
 */
export type AskErrorStage =
  | AskStage
  | "reformulate-retry"
  | "retrieve-retry"
  | "rerank-retry"
  | "budget"
  | "deadline"
  | "unknown";

/**
 * Whether an answer stands on evidence. `no_evidence` is a real,
 * useful reply — "the archive does not cover this" — and is kept as
 * conversation history; only an `error` outcome is withheld, and that
 * arrives as an `error` event rather than a `done`.
 */
export type AskAnswerOutcome = "answered" | "no_evidence";

export type AskSourceArticle = AskResponse["sourceArticles"][number];
export type AskMeta = AskResponse["meta"];

export type AskStreamEvent =
  | { type: "stage"; name: AskStage; elapsedMs: number; detail?: string }
  | {
      type: "metadata";
      question: string;
      mode: "text" | "visual";
      requestId: string;
      sourceArticles: AskSourceArticle[];
      meta: Partial<AskMeta>;
    }
  | { type: "delta"; text: string }
  | {
      type: "tool_call";
      tool: string;
      round: number;
      args?: Record<string, unknown>;
    }
  | { type: "tool_result"; tool: string; round: number; summary?: string }
  | {
      type: "done";
      answer: string;
      citations: AskResponse["citations"];
      confidence: AskResponse["confidence"];
      outcome: AskAnswerOutcome;
      sessionId: string;
      requestId: string;
      sourceArticles?: AskSourceArticle[];
      followUpQuestions?: string[];
      meta: AskMeta;
    }
  | {
      type: "error";
      /** Required: the client cannot offer the right recovery without it. */
      kind: AskErrorKind;
      stage: AskErrorStage;
      message: string;
      requestId: string;
      retryAfterSec?: number;
      cause?: string;
    };

/**
 * The subset the agent loop reports as it researches. Aliased here so
 * the loop and the route cannot disagree about the shape, and so an
 * agent answer can stream its text like the pipeline path does.
 */
export type AskAgentProgressEvent = Extract<
  AskStreamEvent,
  { type: "tool_call" } | { type: "tool_result" } | { type: "delta" }
>;

/** Wire format: one JSON object per `data:` frame, frames split by a blank line. */
export function encodeAskStreamEvent(event: AskStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * Parse one frame. Returns null for anything that is not a `data:` line
 * carrying a JSON object with a string `type`, so a truncated or
 * malformed frame is skipped rather than crashing the reader.
 */
export function parseAskStreamFrame(frame: string): AskStreamEvent | null {
  const trimmed = frame.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^data:\s*([\s\S]*)$/);
  if (!match) return null;
  try {
    const value = JSON.parse(match[1]) as unknown;
    return typeof value === "object" &&
      value !== null &&
      typeof (value as { type?: unknown }).type === "string"
      ? (value as AskStreamEvent)
      : null;
  } catch {
    return null;
  }
}
