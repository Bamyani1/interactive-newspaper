import { describe, it, expect } from "vitest";
import {
  encodeAskStreamEvent,
  parseAskStreamFrame,
  type AskStreamEvent,
} from "@/src/lib/ask-stream-events";

describe("ask stream event wire format", () => {
  it("round-trips every event the server sends", () => {
    const events: AskStreamEvent[] = [
      { type: "stage", name: "reformulate", elapsedMs: 12, detail: "student protests" },
      { type: "stage", name: "generate", elapsedMs: 900 },
      {
        type: "metadata",
        question: "who edited the paper?",
        mode: "text",
        requestId: "req-1",
        sourceArticles: [],
        meta: { method: "hybrid" },
      },
      { type: "delta", text: "The editor " },
      { type: "tool_call", tool: "search_archive", round: 1, args: { query: "editor" } },
      { type: "tool_result", tool: "search_archive", round: 1, summary: "4 articles" },
      {
        type: "done",
        answer: "The editor was …",
        citations: [],
        confidence: "medium",
        outcome: "answered",
        sessionId: "sess-1",
        requestId: "req-1",
        meta: {
          retrievalTimeMs: 1,
          generationTimeMs: 2,
          totalTimeMs: 3,
          articlesSearched: 4,
          method: "hybrid",
        },
      },
      {
        type: "error",
        kind: "rate_limit",
        stage: "generate",
        message: "quota reached",
        requestId: "req-1",
        retryAfterSec: 30,
        cause: "quota_exhausted",
      },
    ];

    for (const event of events) {
      const frame = encodeAskStreamEvent(event);
      expect(frame.endsWith("\n\n")).toBe(true);
      expect(frame.startsWith("data: ")).toBe(true);
      expect(parseAskStreamFrame(frame)).toEqual(event);
    }
  });

  it("reads a frame whose payload contains a blank line", () => {
    const event: AskStreamEvent = { type: "delta", text: "one\n\ntwo" };
    expect(parseAskStreamFrame(encodeAskStreamEvent(event))).toEqual(event);
  });

  it("skips a frame it cannot trust rather than throwing", () => {
    // A stream can be cut mid-frame, and a proxy can inject its own
    // lines; neither should take the transcript down.
    expect(parseAskStreamFrame("")).toBeNull();
    expect(parseAskStreamFrame("   ")).toBeNull();
    expect(parseAskStreamFrame(": keep-alive comment")).toBeNull();
    expect(parseAskStreamFrame("event: delta")).toBeNull();
    expect(parseAskStreamFrame('data: {"type":"delta"')).toBeNull();
    expect(parseAskStreamFrame("data: not json")).toBeNull();
    expect(parseAskStreamFrame("data: null")).toBeNull();
    expect(parseAskStreamFrame("data: 42")).toBeNull();
    expect(parseAskStreamFrame('data: ["delta"]')).toBeNull();
    expect(parseAskStreamFrame('data: {"name":"delta"}')).toBeNull();
    expect(parseAskStreamFrame('data: {"type":7}')).toBeNull();
  });
});
