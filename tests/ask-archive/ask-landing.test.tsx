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

    it("renders the hero, lede, and combined footer strip", () => {
        render(<AskLanding onPickQuestion={vi.fn()} />);

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

        // Single combined footer: verification disclaimer + archive scope.
        expect(
            screen.getByText(
                /Answers cite primary sources\. Always verify\. · 1950\s*[–-]\s*2006 · 293 editions · 9,582 articles/,
            ),
        ).toBeInTheDocument();
    });

    it("does NOT render the demo card, dateline, or expired notice", () => {
        render(<AskLanding onPickQuestion={vi.fn()} />);

        // Regression guards — earlier iterations shipped these; v2.1 removed
        // the demo card + dateline + expired notice because they duplicated
        // scope, shouted over the H1, or cluttered the hero.
        expect(
            screen.queryByLabelText(/example of how an answer looks/i),
        ).not.toBeInTheDocument();
        expect(screen.queryByText(/Example answer/)).not.toBeInTheDocument();
        expect(
            screen.queryByText(/Research Desk · Vol\. LVI/),
        ).not.toBeInTheDocument();
        expect(
            screen.queryByText(/your last conversation expired/i),
        ).not.toBeInTheDocument();
    });

    it("renders three daily suggestions and fires onPickQuestion on click", () => {
        const onPick = vi.fn();
        render(<AskLanding onPickQuestion={onPick} />);

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

    it("plays the entrance animation on the first visit and skips it on subsequent visits", () => {
        // First visit — localStorage is clear in beforeEach.
        const { unmount } = render(
            <AskLanding onPickQuestion={vi.fn()} />,
        );
        const landing1 = document.querySelector(".ask-landing");
        expect(landing1).toHaveAttribute("data-animate", "true");
        expect(window.localStorage.getItem(VISITED_KEY)).toBe("1");
        unmount();

        // Second visit — the key is now set; animation should NOT fire.
        render(<AskLanding onPickQuestion={vi.fn()} />);
        const landing2 = document.querySelector(".ask-landing");
        expect(landing2).not.toHaveAttribute("data-animate");
    });
});
