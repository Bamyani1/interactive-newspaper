import React from "react";
import {
    describe,
    it,
    expect,
    vi,
    beforeEach,
    afterEach,
} from "vitest";
import { render, fireEvent, act, screen } from "@testing-library/react";
import type { AskResponse } from "@/src/types";
import { SourceReader } from "@/features/ask-archive/components/SourceReader";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: pushMock, replace: vi.fn() }),
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
        ...overrides,
    };
}

describe("SourceReader — history sentinel", () => {
    let pushSpy: ReturnType<typeof vi.spyOn>;
    let backSpy: ReturnType<typeof vi.spyOn>;
    let replaceSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        pushMock.mockReset();
        pushSpy = vi.spyOn(window.history, "pushState");
        backSpy = vi.spyOn(window.history, "back").mockImplementation(() => {
            // jsdom's history.back is a no-op in some setups; stub so
            // we can assert call counts without the extra popstate
            // firing.
        });
        replaceSpy = vi.spyOn(window.history, "replaceState");
        // Stub fetch so the article-body load in SourceReader doesn't
        // hit a real endpoint during tests.
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
        pushSpy.mockRestore();
        backSpy.mockRestore();
        replaceSpy.mockRestore();
        vi.unstubAllGlobals();
        // Clean any sentinel state left on the current entry so tests
        // don't leak into each other.
        window.history.replaceState(null, "", window.location.href);
    });

    it("pushes the {askReader:true} sentinel when the drawer opens", () => {
        const { rerender } = render(
            <SourceReader source={null} onClose={vi.fn()} />,
        );
        expect(pushSpy).not.toHaveBeenCalled();

        rerender(<SourceReader source={makeSource()} onClose={vi.fn()} />);

        expect(pushSpy).toHaveBeenCalledTimes(1);
        expect(pushSpy).toHaveBeenCalledWith({ askReader: true }, "");
    });

    it("rewinds the sentinel via history.back when source becomes null", () => {
        const onClose = vi.fn();
        const { rerender } = render(
            <SourceReader source={makeSource()} onClose={onClose} />,
        );
        expect(pushSpy).toHaveBeenCalledTimes(1);

        // The push call above synchronously mutates window.history.state.
        // Explicitly set it so the null-branch guard can see the sentinel.
        window.history.replaceState({ askReader: true }, "");

        rerender(<SourceReader source={null} onClose={onClose} />);

        expect(backSpy).toHaveBeenCalledTimes(1);
    });

    it("calls onClose when a popstate event fires while the drawer is open", () => {
        const onClose = vi.fn();
        render(<SourceReader source={makeSource()} onClose={onClose} />);
        expect(pushSpy).toHaveBeenCalledTimes(1);

        act(() => {
            window.dispatchEvent(new PopStateEvent("popstate"));
        });

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("neutralizes the sentinel via replaceState on unmount (not back) so Clear Conversation doesn't feel like a back-navigation", () => {
        const onClose = vi.fn();
        const { unmount } = render(
            <SourceReader source={makeSource()} onClose={onClose} />,
        );
        expect(pushSpy).toHaveBeenCalledTimes(1);
        // Simulate the real browser putting the sentinel on the current
        // entry after pushState.
        window.history.replaceState({ askReader: true }, "");
        replaceSpy.mockClear();
        expect(backSpy).not.toHaveBeenCalled();

        unmount();

        // Unmount-time cleanup must NOT call history.back() — that was
        // the root cause of the Clear-Conversation-feels-like-back bug.
        expect(backSpy).not.toHaveBeenCalled();
        // Instead it clears the sentinel marker in place.
        expect(replaceSpy).toHaveBeenCalledWith(null, "");
    });

    it("strips askReader via replaceState and calls router.push on 'Open full edition'", async () => {
        const onClose = vi.fn();
        const source = makeSource({ editionDate: "1991-12-11" });
        render(<SourceReader source={source} onClose={onClose} />);
        // Mimic the pushState side-effect so the click handler's
        // `window.history.state?.askReader` guard passes.
        window.history.replaceState(
            { askReader: true, keep: "other" },
            "",
            window.location.href,
        );
        replaceSpy.mockClear();

        const link = await screen.findByText(/open full edition/i);
        fireEvent.click(link);

        // replaceState called with askReader removed but other keys kept.
        expect(replaceSpy).toHaveBeenCalledTimes(1);
        const [replacedState] = replaceSpy.mock.calls[0] as [
            Record<string, unknown>,
            string,
            string,
        ];
        expect(replacedState).not.toHaveProperty("askReader");
        expect(replacedState).toHaveProperty("keep", "other");

        expect(pushMock).toHaveBeenCalledWith("/edition/1991-12-11");
    });
});
