import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { SidebarPlayer } from "../../src/features/music-player/components/SidebarPlayer";

const MOCK_TRACKS = [
    { rank: 1, title: "Song One", artist: "Artist A", youtubeId: "abc123" },
    { rank: 2, title: "Song Two", artist: "Artist B", youtubeId: "def456" },
];

vi.mock("../../src/features/music-player/hooks/useMonthlyTrendingMusic", () => ({
    useMonthlyTrendingMusic: () => ({
        tracks: MOCK_TRACKS,
        monthLabel: "January 1987",
        monthNameOnly: "January",
        isLoading: false,
        error: null,
        reason: null,
    }),
}));

let coarsePointer = false;

function createMatchMedia(query: string): MediaQueryList {
    return {
        matches: query === "(pointer: coarse)" ? coarsePointer : false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
    };
}

function getSurface(container: HTMLElement): HTMLElement {
    const surface = container.querySelector(".sidebar-player-surface");
    expect(surface).toBeTruthy();
    return surface as HTMLElement;
}

function mockSurfaceRect(surface: HTMLElement) {
    Object.defineProperty(surface, "getBoundingClientRect", {
        configurable: true,
        value: () =>
            ({
                x: 100,
                y: 100,
                left: 100,
                top: 100,
                right: 300,
                bottom: 280,
                width: 200,
                height: 180,
                toJSON: () => ({}),
            }) as DOMRect,
    });
}

describe("SidebarPlayer proximity surface behavior", () => {
    beforeEach(() => {
        coarsePointer = false;

        Object.defineProperty(window, "matchMedia", {
            writable: true,
            configurable: true,
            value: vi.fn().mockImplementation((query: string) => createMatchMedia(query)),
        });

        vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
            cb(0);
            return 1;
        });
        vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    });

    it("applies ghostly baseline variables at rest", () => {
        const { container } = render(<SidebarPlayer currentDate="1987-01-15" />);
        const surface = getSurface(container);

        expect(parseFloat(surface.style.getPropertyValue("--yt-surface-opacity"))).toBeCloseTo(0.35, 2);
        expect(parseFloat(surface.style.getPropertyValue("--yt-surface-brightness"))).toBeCloseTo(0.7, 2);
    });

    it("brightens when pointer gets near and returns to baseline when far", async () => {
        const { container } = render(<SidebarPlayer currentDate="1987-01-15" />);
        const surface = getSurface(container);
        mockSurfaceRect(surface);

        fireEvent.mouseMove(window, { clientX: 180, clientY: 160 });

        await waitFor(() => {
            expect(parseFloat(surface.style.getPropertyValue("--yt-surface-opacity"))).toBeGreaterThan(0.35);
            expect(parseFloat(surface.style.getPropertyValue("--yt-surface-brightness"))).toBeGreaterThan(0.7);
        });

        fireEvent.mouseMove(window, { clientX: 1400, clientY: 900 });

        await waitFor(() => {
            expect(parseFloat(surface.style.getPropertyValue("--yt-surface-opacity"))).toBeCloseTo(0.35, 2);
            expect(parseFloat(surface.style.getPropertyValue("--yt-surface-brightness"))).toBeCloseTo(0.7, 2);
        });
    });

    it("keeps full visibility on coarse pointers", async () => {
        coarsePointer = true;

        const { container } = render(<SidebarPlayer currentDate="1987-01-15" />);
        const surface = getSurface(container);
        mockSurfaceRect(surface);

        await waitFor(() => {
            expect(parseFloat(surface.style.getPropertyValue("--yt-surface-opacity"))).toBeCloseTo(0.35, 2);
            expect(parseFloat(surface.style.getPropertyValue("--yt-surface-brightness"))).toBeCloseTo(1, 2);
        });

        fireEvent.mouseMove(window, { clientX: 180, clientY: 160 });

        await waitFor(() => {
            expect(parseFloat(surface.style.getPropertyValue("--yt-surface-opacity"))).toBeCloseTo(0.35, 2);
            expect(parseFloat(surface.style.getPropertyValue("--yt-surface-brightness"))).toBeCloseTo(1, 2);
        });
    });
});
