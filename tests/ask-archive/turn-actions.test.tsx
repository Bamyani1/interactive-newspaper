/**
 * Copy answer and thumbs up/down.
 *
 * Both live in the row under a settled answer. Copy flattens citations
 * to plain [N] so a pasted answer keeps its evidence; rating needs a
 * requestId to join against server-side, so a turn that never reached
 * the metadata frame is read-only.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { Turn } from "@/features/ask-archive/components/Turn";
import type { Turn as TurnData } from "@/features/ask-archive/hooks/askReducer";

function makeTurn(overrides: Partial<TurnData> = {}): TurnData {
  return {
    id: "t-1",
    question: "Who edited the paper in 1962?",
    answer: "A student editor did.",
    status: "done",
    sourceArticles: [],
    citations: [],
    meta: null,
    confidence: "high",
    requestId: "req-1",
    mode: "text",
    createdAt: 0,
    ...overrides,
  };
}

function renderTurn(turn: TurnData, props: Partial<React.ComponentProps<typeof Turn>> = {}) {
  return render(
    <Turn
      turn={turn}
      onFollowUp={vi.fn()}
      onRetry={vi.fn()}
      onRegenerate={vi.fn()}
      onEditAndResend={vi.fn()}
      onFeedback={vi.fn()}
      {...props}
    />
  );
}

describe("copy answer", () => {
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("copies the answer with citations flattened to [N]", async () => {
    renderTurn(
      makeTurn({
        answer: "Enrollment rose [Source 2] . Tuition held steady [Source 1].",
      })
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy answer" }));
    });

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0][0]).toBe("Enrollment rose [2]. Tuition held steady [1].");
  });

  it("resolves agent-style citations through the source list", async () => {
    renderTurn(
      makeTurn({
        answer: "The chapel burned [1962-04-05-3].",
        sourceArticles: [
          {
            id: "1962-04-05-3",
            headline: "Chapel fire",
            editionDate: "1962-04-05",
            category: "News",
            summary: "",
            bodySnippet: "",
            imageUrls: [],
          },
        ] as TurnData["sourceArticles"],
      })
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy answer" }));
    });

    expect(writeText.mock.calls[0][0]).toBe("The chapel burned [1].");
  });

  it("shows a copied state and returns to the copy affordance", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderTurn(makeTurn());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy answer" }));
    });
    await waitFor(() => screen.getByRole("button", { name: "Answer copied" }));

    act(() => {
      vi.advanceTimersByTime(1600);
    });
    expect(screen.getByRole("button", { name: "Copy answer" })).toBeTruthy();
  });

  it("falls back to a selection copy when the clipboard API is absent", () => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    const execCommand = vi.fn().mockReturnValue(true);
    (document as unknown as { execCommand: unknown }).execCommand = execCommand;

    renderTurn(makeTurn());
    fireEvent.click(screen.getByRole("button", { name: "Copy answer" }));

    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("offers no copy button on a turn that produced no text", () => {
    renderTurn(
      makeTurn({ status: "error", answer: "", errorKind: "server", errorMessage: "Nope" })
    );
    expect(screen.queryByRole("button", { name: "Copy answer" })).toBeNull();
  });
});

describe("answer rating", () => {
  it("reports the vote with the turn it belongs to", () => {
    const onFeedback = vi.fn();
    renderTurn(makeTurn(), { onFeedback });

    fireEvent.click(screen.getByRole("button", { name: "Good answer" }));
    expect(onFeedback).toHaveBeenCalledWith("t-1", "up");

    fireEvent.click(screen.getByRole("button", { name: "Bad answer" }));
    expect(onFeedback).toHaveBeenCalledWith("t-1", "down");
  });

  it("marks the recorded vote as pressed", () => {
    renderTurn(makeTurn({ feedback: "down" }));

    expect(screen.getByRole("button", { name: "Bad answer" }).getAttribute("aria-pressed")).toBe(
      "true"
    );
    expect(screen.getByRole("button", { name: "Good answer" }).getAttribute("aria-pressed")).toBe(
      "false"
    );
  });

  it("withholds rating from a turn that never reached the server", () => {
    renderTurn(makeTurn({ status: "stopped", requestId: "" }));

    expect(screen.queryByRole("button", { name: "Good answer" })).toBeNull();
    // Copy still applies: the text that did arrive is real.
    expect(screen.getByRole("button", { name: "Copy answer" })).toBeTruthy();
  });

  it("withholds rating from an answer that is still streaming", () => {
    renderTurn(makeTurn({ status: "streaming" }));
    expect(screen.queryByRole("button", { name: "Good answer" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy answer" })).toBeNull();
  });

  it("renders no controls at all in the export snapshot", () => {
    renderTurn(makeTurn(), { exportMode: true });

    expect(screen.queryByRole("button", { name: "Copy answer" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Good answer" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Regenerate answer" })).toBeNull();
  });
});
