/**
 * Per-thread controls: open, rename, delete.
 *
 * The list is shared by the desktop sidebar and the mobile sheet, so a
 * thread offers the same three actions wherever it is listed. Rename is
 * the reader's name for the thread, not the conversation's, so it must
 * never reorder the sidebar.
 */

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  ThreadList,
  threadLabel,
  truncateAtWord,
} from "@/features/ask-archive/components/ThreadList";
import type { ThreadSummary } from "@/features/ask-archive/hooks/askReducer";

function makeThread(overrides: Partial<ThreadSummary> = {}): ThreadSummary {
  return {
    id: "s-1",
    firstQuestion: "Who edited the paper in 1962?",
    turnCount: 2,
    lastUpdatedAt: Date.now(),
    ...overrides,
  };
}

function renderList(
  threads: ThreadSummary[],
  props: Partial<React.ComponentProps<typeof ThreadList>> = {}
) {
  const handlers = {
    onSwitchThread: vi.fn(),
    onRenameThread: vi.fn(),
    onRequestDelete: vi.fn(),
  };
  render(<ThreadList threads={threads} activeThreadId={null} {...handlers} {...props} />);
  return handlers;
}

describe("thread label", () => {
  it("prefers the reader's name over the first question", () => {
    expect(threadLabel(makeThread({ title: "Editors" }))).toBe("Editors");
  });

  it("falls back to the first question when the name is blank", () => {
    expect(threadLabel(makeThread({ title: "   " }))).toBe("Who edited the paper in 1962?");
  });

  it("truncates at a word boundary", () => {
    const long =
      "What did the trustees decide about the new library building in the spring of 1971";
    const short = truncateAtWord(long);
    expect(short.length).toBeLessThanOrEqual(61);
    expect(short.endsWith("…")).toBe(true);
    expect(short).not.toMatch(/\s…$/);
    // Never cuts mid-word: the last whole word survives intact.
    expect(long.startsWith(short.slice(0, -1))).toBe(true);
  });

  it("leaves a short label alone", () => {
    expect(truncateAtWord("Editors")).toBe("Editors");
  });
});

describe("thread list", () => {
  it("opens a thread by its display name", () => {
    const { onSwitchThread } = renderList([makeThread({ title: "Editors" })]);

    fireEvent.click(screen.getByRole("button", { name: "Open thread: Editors" }));
    expect(onSwitchThread).toHaveBeenCalledWith("s-1");
  });

  it("commits a rename on Enter", () => {
    const { onRenameThread } = renderList([makeThread()]);

    fireEvent.click(
      screen.getByRole("button", { name: "Rename thread: Who edited the paper in 1962?" })
    );
    const field = screen.getByRole("textbox");
    fireEvent.change(field, { target: { value: "Sixties editors" } });
    fireEvent.submit(field.closest("form")!);

    expect(onRenameThread).toHaveBeenCalledWith("s-1", "Sixties editors");
  });

  it("abandons a rename on Escape", () => {
    const { onRenameThread } = renderList([makeThread()]);

    fireEvent.click(
      screen.getByRole("button", { name: "Rename thread: Who edited the paper in 1962?" })
    );
    const field = screen.getByRole("textbox");
    fireEvent.change(field, { target: { value: "discarded" } });
    fireEvent.keyDown(field, { key: "Escape" });

    expect(onRenameThread).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("asks before deleting rather than deleting on the press", () => {
    const { onRequestDelete } = renderList([makeThread({ title: "Editors" })]);

    fireEvent.click(screen.getByRole("button", { name: "Delete thread: Editors" }));
    expect(onRequestDelete).toHaveBeenCalledWith(expect.objectContaining({ id: "s-1" }));
  });

  it("says so when there is nothing archived yet", () => {
    renderList([]);
    expect(screen.getByText(/No conversation yet/i)).toBeTruthy();
  });
});
