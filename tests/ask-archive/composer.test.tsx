/**
 * Composer controls while an answer is arriving.
 *
 * The composer used to be disabled outright for the whole of generation,
 * which left the reader with no way to interrupt a long or wrong answer
 * and nothing to do but wait. It stays usable now: Send becomes Stop,
 * Enter is inert, and Escape stops.
 */

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Composer } from "@/features/ask-archive/components/Composer";

describe("Composer", () => {
  it("offers Send when idle and Stop while an answer streams", () => {
    const { rerender } = render(<Composer onSubmit={vi.fn()} onStop={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Send question" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop generating" })).not.toBeInTheDocument();

    rerender(<Composer onSubmit={vi.fn()} onStop={vi.fn()} isStreaming />);
    expect(screen.getByRole("button", { name: "Stop generating" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Send question" })).not.toBeInTheDocument();
  });

  it("keeps the textarea usable while streaming so Stop is reachable", () => {
    render(<Composer onSubmit={vi.fn()} onStop={vi.fn()} isStreaming />);
    expect(screen.getByLabelText("Ask a question")).toBeEnabled();
  });

  it("disables the whole composer only while hydrating", () => {
    render(<Composer onSubmit={vi.fn()} onStop={vi.fn()} disabled />);
    expect(screen.getByLabelText("Ask a question")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send question" })).toBeDisabled();
  });

  it("clicking Stop interrupts the answer", () => {
    const onStop = vi.fn();
    render(<Composer onSubmit={vi.fn()} onStop={onStop} isStreaming />);
    fireEvent.click(screen.getByRole("button", { name: "Stop generating" }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("Escape stops the answer instead of blurring while streaming", () => {
    const onStop = vi.fn();
    render(<Composer onSubmit={vi.fn()} onStop={onStop} isStreaming />);
    const textarea = screen.getByLabelText("Ask a question");
    textarea.focus();
    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(textarea);
  });

  it("Escape blurs when nothing is streaming", () => {
    const onStop = vi.fn();
    render(<Composer onSubmit={vi.fn()} onStop={onStop} />);
    const textarea = screen.getByLabelText("Ask a question");
    textarea.focus();
    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(onStop).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(textarea);
  });

  it("Enter is inert while streaming, so a second pipeline never starts", () => {
    const onSubmit = vi.fn();
    render(<Composer onSubmit={onSubmit} onStop={vi.fn()} isStreaming />);
    const textarea = screen.getByLabelText("Ask a question");
    fireEvent.change(textarea, { target: { value: "a second question" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
    // The draft is kept, not swallowed.
    expect(textarea).toHaveValue("a second question");
  });

  it("Enter sends once the answer has settled", () => {
    const onSubmit = vi.fn();
    render(<Composer onSubmit={onSubmit} onStop={vi.fn()} />);
    const textarea = screen.getByLabelText("Ask a question");
    fireEvent.change(textarea, { target: { value: "  who edited it?  " } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith("who edited it?");
    expect(textarea).toHaveValue("");
  });

  // Without maxLength a long paste was accepted, sent, rejected with a 400
  // and rendered as an error turn — the reader learned the limit by
  // tripping it, with their question already gone from the box.
  it("caps the question at the length the route accepts", () => {
    render(<Composer onSubmit={vi.fn()} onStop={vi.fn()} />);
    expect(screen.getByLabelText("Ask a question")).toHaveAttribute("maxLength", "1000");
  });

  it("counts down only as the reader approaches the limit", () => {
    render(<Composer onSubmit={vi.fn()} onStop={vi.fn()} />);
    const textarea = screen.getByLabelText("Ask a question");
    fireEvent.change(textarea, { target: { value: "a".repeat(899) } });
    expect(screen.queryByText(/characters left/i)).not.toBeInTheDocument();
    fireEvent.change(textarea, { target: { value: "a".repeat(960) } });
    expect(screen.getByText("40 characters left")).toBeInTheDocument();
  });

  it("does not steal focus on a touch device, where it would raise the keyboard", () => {
    const matchMedia = vi.fn((query: string) => ({
      matches: query.includes("coarse"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      onchange: null,
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;
    vi.stubGlobal("matchMedia", matchMedia);
    try {
      render(<Composer onSubmit={vi.fn()} onStop={vi.fn()} focusSignal="t-1:done" />);
      expect(document.activeElement).not.toBe(screen.getByLabelText("Ask a question"));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("takes focus on a fine pointer once an answer lands", () => {
    render(<Composer onSubmit={vi.fn()} onStop={vi.fn()} focusSignal="t-1:done" />);
    expect(document.activeElement).toBe(screen.getByLabelText("Ask a question"));
  });

  it("Shift+Enter never sends", () => {
    const onSubmit = vi.fn();
    render(<Composer onSubmit={onSubmit} onStop={vi.fn()} />);
    const textarea = screen.getByLabelText("Ask a question");
    fireEvent.change(textarea, { target: { value: "first line" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
