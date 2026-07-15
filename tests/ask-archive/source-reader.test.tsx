import React, { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AskResponse } from "@/src/types";
import { SourceReader } from "@/features/ask-archive/components/SourceReader";

vi.mock("next/link", () => ({
    default: ({
        children,
        onClick,
        ...props
    }: React.PropsWithChildren<
        React.AnchorHTMLAttributes<HTMLAnchorElement>
    >) => (
        <a
            {...props}
            onClick={(event) => {
                event.preventDefault();
                onClick?.(event);
            }}
        >
            {children}
        </a>
    ),
}));

type SourceArticle = AskResponse["sourceArticles"][number];

function makeSource(overrides: Partial<SourceArticle> = {}): SourceArticle {
    return {
        id: "1960-01-07-0",
        headline: "Test Article",
        editionDate: "1960-01-07",
        category: "News",
        summary: "Test summary",
        byline: "Test Author",
        bodySnippet: "A snippet from the article.",
        distance: 0.25,
        imageUrls: [],
        imageCaptions: [],
        ...overrides,
    };
}

function ReaderHarness() {
    const [source, setSource] = useState<SourceArticle | null>(null);
    return (
        <>
            <button type="button" onClick={() => setSource(makeSource())}>
                Open source
            </button>
            <SourceReader source={source} onClose={() => setSource(null)} />
        </>
    );
}

function ReaderWithPhotoHarness() {
    const [source, setSource] = useState<SourceArticle | null>(null);
    return (
        <>
            <button
                type="button"
                onClick={() =>
                    setSource(
                        makeSource({
                            imageUrls: [
                                "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8'/%3E",
                            ],
                            imageCaptions: ["Newsroom"],
                        }),
                    )
                }
            >
                Open source with photo
            </button>
            <SourceReader source={source} onClose={() => setSource(null)} />
        </>
    );
}

describe("SourceReader — accessible modal behavior", () => {
    beforeEach(() => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({
                ok: true,
                json: () =>
                    Promise.resolve({
                        articles: [
                            {
                                id: "1960-01-07-0",
                                headline: "Test Article",
                                byline: "Test Author",
                                fullText: "<p>Body.</p>",
                                category: "News",
                                page: 1,
                            },
                        ],
                    }),
            }) as unknown as typeof fetch,
        );
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        document.body.style.overflow = "";
    });

    it("renders no dialog while closed", () => {
        render(<SourceReader source={null} onClose={vi.fn()} />);
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("labels the dialog, focuses Close, locks scroll, and makes the page inert", async () => {
        const { container } = render(
            <SourceReader source={makeSource()} onClose={vi.fn()} />,
        );

        expect(
            await screen.findByRole("dialog", { name: "Test Article" }),
        ).toHaveAttribute("aria-modal", "true");
        expect(
            screen.getByRole("button", { name: /close article reader/i }),
        ).toHaveFocus();
        expect(document.body.style.overflow).toBe("hidden");
        expect(container.inert).toBe(true);
        expect(container).toHaveAttribute("aria-hidden", "true");
    });

    it("traps focus and restores it when Escape closes the reader", async () => {
        render(<ReaderHarness />);
        const trigger = screen.getByRole("button", { name: "Open source" });
        trigger.focus();
        fireEvent.click(trigger);

        const close = await screen.findByRole("button", {
            name: /close article reader/i,
        });
        const editionLink = screen.getByRole("link", {
            name: /open full edition/i,
        });
        expect(close).toHaveFocus();

        fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
        expect(editionLink).toHaveFocus();
        fireEvent.keyDown(document, { key: "Tab" });
        expect(close).toHaveFocus();

        fireEvent.keyDown(document, { key: "Escape" });
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        expect(trigger).toHaveFocus();
        expect(document.body.style.overflow).toBe("");
    });

    it("lets Escape close a nested photo viewer before the source reader", async () => {
        render(<ReaderWithPhotoHarness />);
        const trigger = screen.getByRole("button", {
            name: "Open source with photo",
        });
        trigger.focus();
        fireEvent.click(trigger);

        const reader = await screen.findByRole("dialog", {
            name: "Test Article",
        });
        const photo = screen.getByRole("button", {
            name: "Expand Test Article — image 1",
        });
        photo.focus();
        fireEvent.click(photo);
        expect(
            await screen.findByRole("dialog", { name: "Photo viewer" }),
        ).toBeInTheDocument();

        fireEvent.keyDown(document, { key: "Escape" });
        await waitFor(() =>
            expect(
                screen.queryByRole("dialog", { name: "Photo viewer" }),
            ).toBeNull(),
        );
        expect(reader).toBeInTheDocument();
        expect(photo).toHaveFocus();

        fireEvent.keyDown(document, { key: "Escape" });
        await waitFor(() =>
            expect(
                screen.queryByRole("dialog", { name: "Test Article" }),
            ).toBeNull(),
        );
        expect(trigger).toHaveFocus();
    });

    it("closes only when the backdrop itself is clicked", async () => {
        const onClose = vi.fn();
        render(<SourceReader source={makeSource()} onClose={onClose} />);
        const dialog = await screen.findByRole("dialog");

        fireEvent.click(dialog);
        expect(onClose).not.toHaveBeenCalled();
        fireEvent.click(dialog.parentElement!);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("uses a Next-compatible link without mutating browser history", async () => {
        const onClose = vi.fn();
        const pushState = vi.spyOn(window.history, "pushState");
        const replaceState = vi.spyOn(window.history, "replaceState");
        const back = vi.spyOn(window.history, "back");
        render(
            <SourceReader
                source={makeSource({ editionDate: "1991-12-11" })}
                onClose={onClose}
            />,
        );

        const link = await screen.findByRole("link", {
            name: /open full edition/i,
        });
        expect(link).toHaveAttribute("href", "/edition/1991-12-11");
        fireEvent.click(link);

        expect(onClose).toHaveBeenCalledTimes(1);
        expect(pushState).not.toHaveBeenCalled();
        expect(replaceState).not.toHaveBeenCalled();
        expect(back).not.toHaveBeenCalled();
        pushState.mockRestore();
        replaceState.mockRestore();
        back.mockRestore();
    });

    it("does not expose transport errors to readers", async () => {
        vi.mocked(fetch).mockRejectedValueOnce(new Error("HTTP 500 secret"));
        render(<SourceReader source={makeSource()} onClose={vi.fn()} />);

        expect(
            await screen.findByText("Unable to load this article right now."),
        ).toBeInTheDocument();
        expect(screen.queryByText(/HTTP 500 secret/)).not.toBeInTheDocument();
    });

    it("numbers a complete source photo strip from image one", async () => {
        render(
            <SourceReader
                source={makeSource({
                    imageUrls: ["/source-photo.webp"],
                    imageCaptions: [null],
                })}
                onClose={vi.fn()}
            />,
        );

        expect(
            await screen.findByRole("button", {
                name: "Expand Test Article — image 1",
            }),
        ).toBeInTheDocument();
    });
});
