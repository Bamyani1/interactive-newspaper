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
import AskPage from "@/app/ask/AskWorkspace";

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
        retry: vi.fn(),
        clearConversation: vi.fn(),
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
        expect(
            screen.getByLabelText(/suggested questions, refreshed daily/i),
        ).toBeInTheDocument();
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
            screen.getByText(/your last conversation expired/i),
        ).toBeInTheDocument();
        expect(
            screen.getByLabelText(/suggested questions, refreshed daily/i),
        ).toBeInTheDocument();
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
            screen.queryByLabelText(/suggested questions, refreshed daily/i),
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
                name: /clear the current thread/i,
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
                name: /clear the current thread/i,
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
            })[0],
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
        expect(
            screen.getByLabelText(/suggested questions, refreshed daily/i),
        ).toBeInTheDocument();
        expect(
            screen.getByText(/checking for a saved conversation/i),
        ).toBeInTheDocument();
        expect(
            screen.getByRole("complementary"),
        ).toBeInTheDocument();
        expect(
            screen.getByRole("log", { name: /conversation transcript/i }),
        ).toHaveAttribute("aria-busy", "true");
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
});
