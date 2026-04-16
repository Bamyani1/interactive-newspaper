import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ConversationHistory } from "@/features/ask-archive";

function mockStorage(initial: Record<string, string> = {}): void {
    const store = { ...initial };
    vi.stubGlobal("localStorage", {
        getItem: (k: string) => (k in store ? store[k] : null),
        setItem: (k: string, v: string) => {
            store[k] = v;
        },
        removeItem: (k: string) => {
            delete store[k];
        },
        clear: () => {
            for (const k of Object.keys(store)) delete store[k];
        },
        key: (i: number) => Object.keys(store)[i] ?? null,
        length: 0,
    });
}

describe("ConversationHistory", () => {
    beforeEach(() => {
        mockStorage({ "owu-ask-session-id": "sid-123" });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("renders nothing when the session has no turns", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ turns: [] }),
            }),
        );
        const { container } = render(
            <ConversationHistory onSelect={() => {}} />,
        );
        // Wait a microtask tick so the useEffect can run
        await new Promise((r) => setTimeout(r, 0));
        expect(container).toBeEmptyDOMElement();
    });

    it("renders nothing when no sessionId is stored", async () => {
        mockStorage();
        const { container } = render(
            <ConversationHistory onSelect={() => {}} />,
        );
        await new Promise((r) => setTimeout(r, 0));
        expect(container).toBeEmptyDOMElement();
    });

    it("renders each turn's question as a clickable button", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({
                ok: true,
                json: () =>
                    Promise.resolve({
                        turns: [
                            {
                                question: "First Q",
                                answerSnippet: "First A",
                                citedArticleIds: [],
                                timestamp: 1,
                            },
                            {
                                question: "Second Q",
                                answerSnippet: "Second A",
                                citedArticleIds: [],
                                timestamp: 2,
                            },
                        ],
                    }),
            }),
        );
        render(<ConversationHistory onSelect={() => {}} />);
        await waitFor(() => {
            expect(screen.getByRole("button", { name: "First Q" })).toBeInTheDocument();
            expect(screen.getByRole("button", { name: "Second Q" })).toBeInTheDocument();
        });
    });

    it("calls onSelect when a question is clicked", async () => {
        const onSelect = vi.fn();
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({
                ok: true,
                json: () =>
                    Promise.resolve({
                        turns: [
                            {
                                question: "Tell me about sports",
                                answerSnippet: "Sports A",
                                citedArticleIds: [],
                                timestamp: 1,
                            },
                        ],
                    }),
            }),
        );
        render(<ConversationHistory onSelect={onSelect} />);
        const button = await screen.findByRole("button", {
            name: "Tell me about sports",
        });
        fireEvent.click(button);
        expect(onSelect).toHaveBeenCalledWith("Tell me about sports");
    });

    it("disables buttons when disabled prop is true", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({
                ok: true,
                json: () =>
                    Promise.resolve({
                        turns: [
                            {
                                question: "Q1",
                                answerSnippet: "",
                                citedArticleIds: [],
                                timestamp: 1,
                            },
                        ],
                    }),
            }),
        );
        render(<ConversationHistory onSelect={() => {}} disabled />);
        const button = await screen.findByRole("button", { name: "Q1" });
        expect(button).toBeDisabled();
    });
});
