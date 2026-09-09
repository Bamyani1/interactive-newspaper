/**
 * Render-decision tests for `/ask`'s page.tsx. Verify that the branch
 * selecting between AskLanding / Transcript matches what each user state
 * expects while the surrounding workspace stays mounted — in particular,
 * that the expired
 * banner isn't swallowed by the editorial hero on return (F3), and
 * that destructive sidebar actions are disabled while a turn is
 * streaming (F5, tested in Commit C).
 *
 * All downstream side effects are mocked out so we're only exercising
 * the render logic in `src/app/ask/page.tsx`.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Turn } from "@/features/ask-archive/hooks/askReducer";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const mockHook = vi.fn();
const { exportConversationPdfMock } = vi.hoisted(() => ({
  exportConversationPdfMock: vi.fn(),
}));

vi.mock("@/features/ask-archive/hooks/useAskArchive", () => ({
  useAskArchive: () => mockHook(),
}));

vi.mock("@/features/ask-archive/lib/export-conversation-pdf", () => ({
  exportConversationPdf: exportConversationPdfMock,
}));

vi.mock("@/features/ask-archive/hooks/useDeepLinkSubmit", () => ({
  useDeepLinkSubmit: () => {},
}));

vi.mock("@/features/time-controls", () => ({
  TimeControls: () => <div data-testid="time-controls" />,
}));

vi.mock("@/shared", () => ({
  PageShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Import AFTER the mocks are set up.
import AskPage from "@/src/app/ask/AskWorkspace";

function defaultState() {
  return {
    turns: [] as Turn[],
    isHydrating: false,
    expiredBanner: false,
    sessionGen: 0,
    emptyReason: null,
    threads: [] as Array<{
      id: string;
      firstQuestion: string;
      turnCount: number;
      lastUpdatedAt: number;
    }>,
    activeThreadId: null as string | null,
    submit: vi.fn(),
    stop: vi.fn(),
    retry: vi.fn(),
    clearAllThreads: vi.fn(),
    newConversation: vi.fn(),
    switchThread: vi.fn(),
  };
}

function makeDoneTurn(id: string, question: string, answer: string): Turn {
  return {
    id,
    question,
    answer,
    status: "done",
    sourceArticles: [],
    citations: [],
    meta: null,
    confidence: "high",
    requestId: "",
    mode: "text",
    createdAt: 0,
  };
}

function makeStreamingTurn(id: string, question: string): Turn {
  return {
    id,
    question,
    answer: "",
    status: "streaming",
    sourceArticles: [],
    citations: [],
    meta: null,
    confidence: "high",
    requestId: "",
    mode: "text",
    createdAt: 0,
  };
}

describe("AskPage — render decisions", () => {
  beforeEach(() => {
    mockHook.mockReset();
    exportConversationPdfMock.mockReset();
    exportConversationPdfMock.mockResolvedValue(undefined);
  });

  it("first-visit state (sessionGen=0, no turns, no expiry) renders the editorial landing", () => {
    mockHook.mockReturnValue(defaultState());
    render(<AskPage />);
    // The suggestions block's aria-label is unique to AskLanding
    // (AskSidebar also has an H1 "Ask the Archive", so we can't
    // use that heading alone to detect the editorial hero).
    expect(screen.getByLabelText(/suggested questions, refreshed daily/i)).toBeInTheDocument();
  });

  it("expired banner on fresh return renders the notice AND the inline landing so the user has suggestions to click", () => {
    // On return with an expired session, hydrate dispatches
    // { turns: [], expired: true } and sessionGen is still 0.
    // The Transcript renders the notice at the top AND the inline
    // landing below it — earlier we suppressed the landing here,
    // which left the page as just a banner above a giant void.
    mockHook.mockReturnValue({
      ...defaultState(),
      expiredBanner: true,
    });
    render(<AskPage />);
    expect(
      screen.getByText(/server memory for this conversation has aged out/i)
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/suggested questions, refreshed daily/i)).toBeInTheDocument();
  });

  it("returning visitor with prior turns renders Transcript, not the editorial hero", () => {
    mockHook.mockReturnValue({
      ...defaultState(),
      turns: [makeDoneTurn("t-1", "Who won in 1963?", "Bishops won.")],
    });
    render(<AskPage />);
    // The assistant answer only appears in the Transcript (the
    // sidebar only echoes the question as the thread title).
    expect(screen.getByText(/bishops won\./i)).toBeInTheDocument();
    expect(
      screen.queryByLabelText(/suggested questions, refreshed daily/i)
    ).not.toBeInTheDocument();
  });

  it("streaming turn disables Clear and Export everywhere they appear (Commit C / F5)", () => {
    // Users shouldn't be able to wipe or export a conversation
    // while the assistant is mid-answer: Clear aborts silently,
    // Export produces a partial PDF. Both are footguns. We use
    // getAllByRole because the sidebar AND the mobile action strip
    // both surface the same three buttons (the mobile strip is in
    // the DOM at all times, hidden by CSS on desktop).
    mockHook.mockReturnValue({
      ...defaultState(),
      turns: [makeStreamingTurn("t-streaming", "hello?")],
    });
    render(<AskPage />);
    screen
      .getAllByRole("button", {
        name: /clear all threads/i,
      })
      .forEach((btn) => expect(btn).toBeDisabled());
    screen
      .getAllByRole("button", {
        name: /export the conversation as a pdf/i,
      })
      .forEach((btn) => expect(btn).toBeDisabled());
    // New-conversation stays enabled: starting over is a valid
    // escape from a stuck stream.
    screen
      .getAllByRole("button", {
        name: /start a new conversation/i,
      })
      .forEach((btn) => expect(btn).not.toBeDisabled());
  });

  it("done turn enables Clear and Export everywhere (happy-path control)", () => {
    mockHook.mockReturnValue({
      ...defaultState(),
      turns: [makeDoneTurn("t-1", "hi?", "hello.")],
    });
    render(<AskPage />);
    screen
      .getAllByRole("button", {
        name: /clear all threads/i,
      })
      .forEach((btn) => expect(btn).not.toBeDisabled());
    screen
      .getAllByRole("button", {
        name: /export the conversation as a pdf/i,
      })
      .forEach((btn) => expect(btn).not.toBeDisabled());
  });

  it("export button downloads the current conversation PDF without using window.print", async () => {
    const print = vi.fn();
    Object.defineProperty(window, "print", {
      configurable: true,
      value: print,
    });
    const turn = makeDoneTurn("t-1", "What happened?", "A full answer.");
    mockHook.mockReturnValue({
      ...defaultState(),
      turns: [turn],
    });
    render(<AskPage />);

    fireEvent.click(
      screen.getAllByRole("button", {
        name: /export the conversation as a pdf/i,
      })[0]
    );

    await waitFor(() => {
      expect(exportConversationPdfMock).toHaveBeenCalledTimes(1);
    });
    expect(exportConversationPdfMock).toHaveBeenCalledWith([turn]);
    expect(print).not.toHaveBeenCalled();
  });

  it("renders a meaningful, stable workspace while the saved session hydrates", () => {
    mockHook.mockReturnValue({
      ...defaultState(),
      isHydrating: true,
    });
    const { container } = render(<AskPage />);
    expect(container.querySelector(".ask-loading-skeleton")).toBeNull();
    expect(screen.getByLabelText(/suggested questions, refreshed daily/i)).toBeInTheDocument();
    expect(screen.getByText(/checking for a saved conversation/i)).toBeInTheDocument();
    expect(screen.getByRole("complementary")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /conversation transcript/i })).toHaveAttribute(
      "aria-busy",
      "true"
    );
    expect(screen.getByLabelText(/ask a question/i)).toBeDisabled();
    screen
      .getAllByRole("button", { name: /start a new conversation/i })
      .forEach((button) => expect(button).toBeDisabled());
  });

  it("preserves workspace DOM landmarks when hydration restores a thread", () => {
    mockHook.mockReturnValue({
      ...defaultState(),
      isHydrating: true,
    });
    const { container, rerender } = render(<AskPage />);
    const page = container.querySelector(".ask-page");
    const sidebar = container.querySelector(".ask-sidebar");
    const column = container.querySelector(".ask-column");
    const transcript = container.querySelector(".ask-transcript");
    const composer = container.querySelector(".ask-composer");

    mockHook.mockReturnValue({
      ...defaultState(),
      turns: [makeDoneTurn("t-1", "Who edited it?", "An editor did.")],
      threads: [
        {
          id: "thread-1",
          firstQuestion: "Who edited it?",
          turnCount: 1,
          lastUpdatedAt: 1,
        },
      ],
      activeThreadId: "thread-1",
    });
    rerender(<AskPage />);

    expect(container.querySelector(".ask-page")).toBe(page);
    expect(container.querySelector(".ask-sidebar")).toBe(sidebar);
    expect(container.querySelector(".ask-column")).toBe(column);
    expect(container.querySelector(".ask-transcript")).toBe(transcript);
    expect(container.querySelector(".ask-composer")).toBe(composer);
    expect(screen.getByText(/an editor did/i)).toBeInTheDocument();
  });

  it("gives the transcript a clean scroller when the reader changes thread", () => {
    mockHook.mockReturnValue({
      ...defaultState(),
      turns: [makeDoneTurn("t-1", "Who edited it?", "An editor did.")],
      activeThreadId: "thread-1",
      sessionGen: 1,
    });
    const { container, rerender } = render(<AskPage />);
    const transcript = container.querySelector(".ask-transcript");

    // SWITCH_THREAD bumps sessionGen; the transcript's scroll position,
    // follow flag and previous-turn-count live in refs, so it has to be
    // a new element rather than the same one carrying stale state.
    mockHook.mockReturnValue({
      ...defaultState(),
      turns: [makeDoneTurn("t-2", "And the photographer?", "Someone else did.")],
      activeThreadId: "thread-2",
      sessionGen: 2,
    });
    rerender(<AskPage />);

    expect(container.querySelector(".ask-transcript")).not.toBe(transcript);
    // The chrome around it is untouched.
    expect(container.querySelector(".ask-composer")).toBeTruthy();
    expect(screen.getByText(/someone else did/i)).toBeInTheDocument();
  });

  it("warns before clearing every thread and only proceeds after confirmation", () => {
    const clearAllThreads = vi.fn();
    mockHook.mockReturnValue({
      ...defaultState(),
      turns: [makeDoneTurn("t-1", "What happened?", "An answer.")],
      threads: [
        {
          id: "thread-1",
          firstQuestion: "What happened?",
          turnCount: 1,
          lastUpdatedAt: 1,
        },
        {
          id: "thread-2",
          firstQuestion: "Who wrote it?",
          turnCount: 1,
          lastUpdatedAt: 0,
        },
      ],
      activeThreadId: "thread-1",
      clearAllThreads,
    });
    render(<AskPage />);

    fireEvent.click(screen.getAllByRole("button", { name: /clear all threads/i })[0]);

    const warning = screen.getByRole("alertdialog", {
      name: /clear all threads/i,
    });
    expect(warning).toHaveTextContent(/permanently remove 2 saved threads/i);
    // Opening the dialog must not itself destroy anything.
    expect(clearAllThreads).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /^clear all$/i }));
    expect(clearAllThreads).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("first thread not yet archived is counted once in the sidebar and the clear dialog", () => {
    // `threads` only gains the current thread once it is archived, so the live
    // one is prepended for display — otherwise a user mid-first-thread sees an
    // empty sidebar and a dialog offering to clear nothing. The prepend must
    // not double-count once the archive catches up.
    const live = {
      ...defaultState(),
      turns: [makeDoneTurn("t-1", "Who edited it?", "An editor did.")],
      activeThreadId: "thread-live",
      threads: [] as ReturnType<typeof defaultState>["threads"],
    };
    mockHook.mockReturnValue(live);
    const { rerender } = render(<AskPage />);

    const liveThreadRows = () =>
      screen.queryAllByRole("button", { name: /^open thread: who edited it\?$/i });
    const expectThreadsAtStake = (copy: RegExp) => {
      fireEvent.click(screen.getAllByRole("button", { name: /clear all threads/i })[0]);
      expect(screen.getByRole("alertdialog", { name: /clear all threads/i })).toHaveTextContent(
        copy
      );
      fireEvent.click(screen.getByRole("button", { name: /keep threads/i }));
    };

    expect(liveThreadRows()).toHaveLength(1);
    expectThreadsAtStake(/permanently remove 1 saved thread\b/i);

    // Same thread, now archived: still one row, still one thread at stake.
    mockHook.mockReturnValue({
      ...live,
      threads: [
        {
          id: "thread-live",
          firstQuestion: "Who edited it?",
          turnCount: 1,
          lastUpdatedAt: 1,
        },
      ],
    });
    rerender(<AskPage />);

    expect(liveThreadRows()).toHaveLength(1);
    expectThreadsAtStake(/permanently remove 1 saved thread\b/i);

    // Before the live thread has an id there is nothing to list, but clearing
    // still reaches the current conversation, so the dialog floors its count at
    // one rather than offering to remove zero threads.
    mockHook.mockReturnValue({ ...live, activeThreadId: null });
    rerender(<AskPage />);

    expect(liveThreadRows()).toHaveLength(0);
    expectThreadsAtStake(/permanently remove 1 saved thread\b/i);
  });

  it("closes the clear warning without touching any thread on cancel", () => {
    const clearAllThreads = vi.fn();
    mockHook.mockReturnValue({
      ...defaultState(),
      turns: [makeDoneTurn("t-1", "What happened?", "An answer.")],
      threads: [
        {
          id: "thread-1",
          firstQuestion: "What happened?",
          turnCount: 1,
          lastUpdatedAt: 1,
        },
      ],
      activeThreadId: "thread-1",
      clearAllThreads,
    });
    render(<AskPage />);

    fireEvent.click(screen.getAllByRole("button", { name: /clear all threads/i })[0]);
    // Singular copy when only one thread is at stake.
    expect(screen.getByRole("alertdialog", { name: /clear all threads/i })).toHaveTextContent(
      /permanently remove 1 saved thread\b/i
    );

    fireEvent.click(screen.getByRole("button", { name: /keep threads/i }));
    expect(clearAllThreads).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
