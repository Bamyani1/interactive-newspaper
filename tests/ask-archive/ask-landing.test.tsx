import React from "react";
import {
    describe,
    it,
    expect,
    vi,
    beforeEach,
    afterEach,
} from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AskLanding } from "@/features/ask-archive/components/AskLanding";

const VISITED_KEY = "owu-has-visited-ask";

describe("AskLanding", () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("renders the hero, lede, and stats footer", () => {
        render(<AskLanding onPickQuestion={vi.fn()} expiredBanner={false} />);

        // H1 with accent on "archive"
        const heading = screen.getByRole("heading", { level: 1 });
        expect(heading).toHaveTextContent(/Ask the archive/);

        // Lede mentions The Transcript and the verification claim.
        expect(
            screen.getByText(/research desk for/i),
        ).toBeInTheDocument();
        expect(
            screen.getByText(/cites the stories it comes from/i),
        ).toBeInTheDocument();

        // Single source of truth for scope — the mono stats strip.
        expect(
            screen.getByText(/1950\s*[–-]\s*2006\s*·\s*293 editions\s*·\s*9,582 articles/),
        ).toBeInTheDocument();
    });

    it("does NOT render the demo answer card or the old dateline", () => {
        render(<AskLanding onPickQuestion={vi.fn()} expiredBanner={false} />);

        // Regression guard — v1 shipped a demo card + a meta dateline;
        // v2 removed both to reduce scope-duplication and visual noise.
        expect(
            screen.queryByLabelText(/example of how an answer looks/i),
        ).not.toBeInTheDocument();
        expect(screen.queryByText(/Example answer/)).not.toBeInTheDocument();
        expect(
            screen.queryByText(/Research Desk · Vol\. LVI/),
        ).not.toBeInTheDocument();
    });

    it("renders three daily suggestions and fires onPickQuestion on click", () => {
        const onPick = vi.fn();
        render(<AskLanding onPickQuestion={onPick} expiredBanner={false} />);

        const list = screen.getByLabelText(
            /suggested questions, refreshed daily/i,
        );
        const buttons = list.querySelectorAll<HTMLButtonElement>(
            ".ask-landing-suggestion",
        );
        expect(buttons).toHaveLength(3);

        // None of the suggestions should duplicate the excluded question —
        // keeps the landing varied across days.
        buttons.forEach((btn) => {
            expect(btn.textContent).not.toMatch(
                /Tell me about Homecoming in the 1970s/,
            );
        });

        fireEvent.click(buttons[0]);
        expect(onPick).toHaveBeenCalledTimes(1);
        expect(onPick.mock.calls[0][0]).toEqual(
            expect.stringMatching(/.+\?|.+\./),
        );
    });

    it("shows the expired-conversation notice only when expiredBanner=true", () => {
        const { rerender } = render(
            <AskLanding onPickQuestion={vi.fn()} expiredBanner={false} />,
        );
        expect(
            screen.queryByText(/your last conversation expired/i),
        ).not.toBeInTheDocument();

        rerender(
            <AskLanding onPickQuestion={vi.fn()} expiredBanner={true} />,
        );
        expect(
            screen.getByText(/your last conversation expired/i),
        ).toBeInTheDocument();
    });

    it("plays the entrance animation on the first visit and skips it on subsequent visits", () => {
        // First visit — localStorage is clear in beforeEach.
        const { unmount } = render(
            <AskLanding onPickQuestion={vi.fn()} expiredBanner={false} />,
        );
        const landing1 = document.querySelector(".ask-landing");
        expect(landing1).toHaveAttribute("data-animate", "true");
        expect(window.localStorage.getItem(VISITED_KEY)).toBe("1");
        unmount();

        // Second visit — the key is now set; animation should NOT fire.
        render(<AskLanding onPickQuestion={vi.fn()} expiredBanner={false} />);
        const landing2 = document.querySelector(".ask-landing");
        expect(landing2).not.toHaveAttribute("data-animate");
    });
});
