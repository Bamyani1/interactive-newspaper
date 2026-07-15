import React from "react";
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditionDateClient } from "@/src/app/edition/[date]/EditionDateClient";
import { markExplicitEditionNavigation } from "@/shared/navigation/editionNavigation";

const { prefetchMock, pushMock } = vi.hoisted(() => ({
    prefetchMock: vi.fn(),
    pushMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
    useRouter: () => ({ prefetch: prefetchMock, push: pushMock }),
}));

vi.mock("@/features/archive", () => ({
    useArchive: () => ({
        editions: ["1988-10-05", "1988-10-12"],
        hasEditions: true,
    }),
}));

vi.mock("@/features/time-controls", () => ({
    TimeControls: () => null,
}));

vi.mock("@/features/navigation", () => ({
    NavigationSidebar: () => null,
}));

vi.mock("@/features/context-panel/components/ContextSidebar", () => ({
    ContextSidebar: () => null,
}));

vi.mock("@/features/navigation/components/MobileNav", () => ({
    MobileNav: () => null,
}));

vi.mock("@/features/news-feed", () => ({
    NewsFeed: () => <div>Edition feed</div>,
}));

vi.mock("@/features/news-feed/components/NewsFeed", () => ({
    SECTION_ORDER: [],
}));

vi.mock("@/shared", () => ({
    PageShell: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}));

const renderEdition = (currentDate: string) => (
    <EditionDateClient
        currentDate={currentDate}
        articles={[]}
        ads={[]}
        publicationInfo="The Transcript"
    />
);

describe("edition feed scroll restoration", () => {
    beforeEach(() => {
        window.sessionStorage.clear();
    });

    it("starts explicit pushes at top and restores remounted edition positions", () => {
        const { container, rerender, unmount } = render(renderEdition("1988-10-05"));
        const feed = container.querySelector<HTMLDivElement>(".scrollbar-hide");
        expect(feed).not.toBeNull();
        if (!feed) return;

        feed.scrollTop = 240;
        markExplicitEditionNavigation("1988-10-12");
        rerender(renderEdition("1988-10-12"));
        expect(feed.scrollTop).toBe(0);

        feed.scrollTop = 80;
        rerender(renderEdition("1988-10-05"));
        expect(feed.scrollTop).toBe(240);

        rerender(renderEdition("1988-10-12"));
        expect(feed.scrollTop).toBe(80);

        feed.scrollTop = 180;
        act(() => unmount());
        const remounted = render(renderEdition("1988-10-12"));
        const remountedFeed = remounted.container.querySelector<HTMLDivElement>(
            ".scrollbar-hide",
        );
        expect(remountedFeed?.scrollTop).toBe(180);

        markExplicitEditionNavigation("1988-10-05");
        remounted.rerender(renderEdition("1988-10-05"));
        expect(remountedFeed?.scrollTop).toBe(0);
    });
});
