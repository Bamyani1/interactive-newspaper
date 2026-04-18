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

    it("renders the dateline, title, and lede stats", () => {
        render(<AskLanding onPickQuestion={vi.fn()} expiredBanner={false} />);

        expect(
            screen.getByText(/Research Desk · Vol\. LVI · 1950–2006/),
        ).toBeInTheDocument();
        expect(
            screen.getByRole("heading", { level: 1 }),
        ).toHaveTextContent(/A research desk for the/);
        expect(
            screen.getByText(/56 years, 293 editions, and 9,582 articles/),
        ).toBeInTheDocument();
    });

    it("renders the demo answer card with both citations visible", () => {
        render(<AskLanding onPickQuestion={vi.fn()} expiredBanner={false} />);

        expect(screen.getByLabelText(/example of how an answer looks/i))
            .toBeInTheDocument();
        expect(screen.getByText(/Example answer/)).toBeInTheDocument();
        expect(screen.getByText(/Tell me about Homecoming in the 1970s/))
            .toBeInTheDocument();
        // Both demo citations render as superscript markers AND as list items
        // — assert the list-item headline copy is present so we know the
        // source rail rendered end-to-end.
        expect(
            screen.getByText(/Homecoming pep rally draws 2,000/),
        ).toBeInTheDocument();
        expect(
            screen.getByText(/Bishops fall 24–17 at homecoming game/),
        ).toBeInTheDocument();
    });

    it("fires onPickQuestion with the demo question when 'Ask this' is clicked", () => {
        const onPick = vi.fn();
        render(<AskLanding onPickQuestion={onPick} expiredBanner={false} />);

        fireEvent.click(screen.getByRole("button", { name: /ask this/i }));

        expect(onPick).toHaveBeenCalledTimes(1);
        expect(onPick).toHaveBeenCalledWith(
            "Tell me about Homecoming in the 1970s.",
        );
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

        // None of the suggestions should duplicate the demo question —
        // keeps the landing varied.
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

    it("shows the expired-conversation banner only when expiredBanner=true", () => {
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
