import React from "react";
import {
    describe,
    it,
    expect,
    beforeEach,
    afterEach,
    vi,
} from "vitest";
import { render, screen } from "@testing-library/react";
import { LandingAskTeaser } from "@/features/ask-archive/components/LandingAskTeaser";
import { QUESTION_POOL } from "@/features/ask-archive/data/question-pool";

describe("LandingAskTeaser", () => {
    beforeEach(() => {
        // Freeze "today" so the day-of-year pick is deterministic across
        // test runs on different CI dates.
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-04-18T12:00:00Z"));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("renders an anchor to /ask with the encoded daily question", () => {
        render(<LandingAskTeaser />);
        const anchor = screen.getByRole("link");
        const href = anchor.getAttribute("href") ?? "";
        expect(href).toMatch(/^\/ask\?q=/);

        // Decode the q param and confirm it's a real question from the pool.
        const q = decodeURIComponent(href.replace(/^\/ask\?q=/, ""));
        expect(QUESTION_POOL).toContain(q);
    });

    it("shows the 'Try asking' label and the italic question text", () => {
        render(<LandingAskTeaser />);
        expect(screen.getByText(/Try asking/i)).toBeInTheDocument();
        // The question is rendered wrapped in curly quotes.
        const quoted = document.querySelector(".cinema-ask-teaser-text");
        expect(quoted).not.toBeNull();
        expect(quoted!.textContent).toMatch(/^[“"].+[”"]$/);
    });

    it("renders the slot wrapper even before the post-hydration pick", () => {
        // The slot reserves vertical space so the CTA row beneath doesn't
        // jump once the pick lands. The slot should always exist.
        render(<LandingAskTeaser />);
        const slot = document.querySelector(".cinema-ask-teaser-slot");
        expect(slot).not.toBeNull();
    });

    it("picks the same question on two consecutive mounts for the same day", () => {
        const { unmount } = render(<LandingAskTeaser />);
        const first = screen.getByRole("link").getAttribute("href");
        unmount();
        render(<LandingAskTeaser />);
        const second = screen.getByRole("link").getAttribute("href");
        expect(second).toBe(first);
    });
});
