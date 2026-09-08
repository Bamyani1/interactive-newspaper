/**
 * Turn-level controls: regenerate, edit-and-resend, and the notice on a
 * turn the reader stopped.
 *
 * Both controls rewrite the turn in place, which only the final turn can
 * do — an earlier one would need the server to truncate the history
 * behind it — so every earlier turn reads as a record.
 */

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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
      {...props}
    />
  );
}

describe("Turn controls", () => {
  it("offers regenerate and edit on the latest settled turn", () => {
    renderTurn(makeTurn());
    expect(screen.getByRole("button", { name: "Regenerate answer" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit question" })).toBeInTheDocument();
  });

  it("offers neither on an earlier turn", () => {
    renderTurn(makeTurn(), { isLatest: false });
    expect(screen.queryByRole("button", { name: "Regenerate answer" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit question" })).not.toBeInTheDocument();
  });

  it("offers neither while the answer is still arriving", () => {
    renderTurn(makeTurn({ status: "streaming", answer: "half an ans" }));
    expect(screen.queryByRole("button", { name: "Regenerate answer" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit question" })).not.toBeInTheDocument();
  });

  it("offers both on a turn the reader stopped", () => {
    renderTurn(makeTurn({ status: "stopped", answer: "half an ans" }));
    expect(screen.getByRole("button", { name: "Regenerate answer" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit question" })).toBeInTheDocument();
  });

  it("regenerate reports the turn to re-run", () => {
    const onRegenerate = vi.fn();
    renderTurn(makeTurn(), { onRegenerate });
    fireEvent.click(screen.getByRole("button", { name: "Regenerate answer" }));
    expect(onRegenerate).toHaveBeenCalledWith("t-1");
  });

  it("editing replaces the question bubble with a prefilled editor", () => {
    renderTurn(makeTurn());
    fireEvent.click(screen.getByRole("button", { name: "Edit question" }));
    const field = screen.getByLabelText("Edit your question");
    expect(field).toHaveValue("Who edited the paper in 1962?");
    expect(screen.queryByRole("button", { name: "Edit question" })).not.toBeInTheDocument();
  });

  it("Enter in the editor resends the reworded question", () => {
    const onEditAndResend = vi.fn();
    renderTurn(makeTurn(), { onEditAndResend });
    fireEvent.click(screen.getByRole("button", { name: "Edit question" }));
    const field = screen.getByLabelText("Edit your question");
    fireEvent.change(field, { target: { value: "Who edited it in 1963?" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onEditAndResend).toHaveBeenCalledWith("t-1", "Who edited it in 1963?");
  });

  it("Escape cancels the edit and keeps the original question", () => {
    const onEditAndResend = vi.fn();
    renderTurn(makeTurn(), { onEditAndResend });
    fireEvent.click(screen.getByRole("button", { name: "Edit question" }));
    const field = screen.getByLabelText("Edit your question");
    fireEvent.change(field, { target: { value: "discard me" } });
    fireEvent.keyDown(field, { key: "Escape" });
    expect(onEditAndResend).not.toHaveBeenCalled();
    expect(screen.getByText("Who edited the paper in 1962?")).toBeInTheDocument();
  });

  it("an unchanged question is not resent", () => {
    const onEditAndResend = vi.fn();
    renderTurn(makeTurn(), { onEditAndResend });
    fireEvent.click(screen.getByRole("button", { name: "Edit question" }));
    fireEvent.keyDown(screen.getByLabelText("Edit your question"), { key: "Enter" });
    expect(onEditAndResend).not.toHaveBeenCalled();
    expect(screen.getByText("Who edited the paper in 1962?")).toBeInTheDocument();
  });

  it("Shift+Enter in the editor does not resend", () => {
    const onEditAndResend = vi.fn();
    renderTurn(makeTurn(), { onEditAndResend });
    fireEvent.click(screen.getByRole("button", { name: "Edit question" }));
    const field = screen.getByLabelText("Edit your question");
    fireEvent.change(field, { target: { value: "line one" } });
    fireEvent.keyDown(field, { key: "Enter", shiftKey: true });
    expect(onEditAndResend).not.toHaveBeenCalled();
  });

  it("a stopped turn keeps its partial text and says the ending is missing", () => {
    renderTurn(makeTurn({ status: "stopped", answer: "The trustees voted in favour of" }));
    expect(screen.getByText(/the trustees voted in favour of/i)).toBeInTheDocument();
    expect(screen.getByText(/stopped before the answer finished/i)).toBeInTheDocument();
  });

  it("a stopped turn with no text at all still says it was stopped", () => {
    renderTurn(makeTurn({ status: "stopped", answer: "" }));
    expect(screen.getByText(/stopped before it answered/i)).toBeInTheDocument();
  });

  it("the export view shows no controls", () => {
    renderTurn(makeTurn(), { exportMode: true });
    expect(screen.queryByRole("button", { name: "Regenerate answer" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit question" })).not.toBeInTheDocument();
  });
});
