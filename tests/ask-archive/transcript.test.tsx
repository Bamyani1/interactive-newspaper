import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Transcript } from "@/features/ask-archive/components/Transcript";

// `SourceReader` (a descendant via Turn → SourceList → SourceReader)
// touches next/navigation's useRouter. We're mounting Transcript with
// turns=[] so nothing should reach the router, but the import graph
// still evaluates the hook call paths — mock to keep tests honest.
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

describe("Transcript — empty-state indicators", () => {
    const noop = () => {};

    it("shows the 'Restoring conversation' indicator while hydrating with no turns", () => {
        render(
            <Transcript
                turns={[]}
                isHydrating={true}
                expiredBanner={false}
                emptyReason={null}
                onFollowUp={noop}
                onRetry={noop}
            />,
        );
        expect(
            screen.getByText(/restoring conversation/i),
        ).toBeInTheDocument();
        expect(
            screen.queryByText(/conversation cleared/i),
        ).not.toBeInTheDocument();
    });

    it("shows the 'Conversation cleared' pill when emptyReason='cleared'", () => {
        render(
            <Transcript
                turns={[]}
                isHydrating={false}
                expiredBanner={false}
                emptyReason="cleared"
                onFollowUp={noop}
                onRetry={noop}
            />,
        );
        expect(
            screen.getByText(/conversation cleared/i),
        ).toBeInTheDocument();
        // AskLanding content must NOT render in the cleared state.
        expect(
            screen.queryByRole("heading", { level: 1, name: /ask the archive/i }),
        ).not.toBeInTheDocument();
    });

    it("renders the AskLanding suggestions/lede/stats inline when emptyReason='new'", () => {
        render(
            <Transcript
                turns={[]}
                isHydrating={false}
                expiredBanner={false}
                emptyReason="new"
                onFollowUp={noop}
                onRetry={noop}
            />,
        );
        // The inline landing content is present — H1, lede, stats.
        expect(
            screen.getByRole("heading", { level: 1, name: /ask the archive/i }),
        ).toBeInTheDocument();
        expect(
            screen.getByLabelText(/suggested questions, refreshed daily/i),
        ).toBeInTheDocument();
        // Cleared pill must NOT double up.
        expect(
            screen.queryByText(/conversation cleared/i),
        ).not.toBeInTheDocument();
    });

    it("hides the cleared indicator when the expired banner is showing", () => {
        render(
            <Transcript
                turns={[]}
                isHydrating={false}
                expiredBanner={true}
                emptyReason="cleared"
                onFollowUp={noop}
                onRetry={noop}
            />,
        );
        expect(
            screen.queryByText(/conversation cleared/i),
        ).not.toBeInTheDocument();
        expect(
            screen.getByText(/your last conversation expired/i),
        ).toBeInTheDocument();
    });

    it("hides inline landing and cleared indicators while hydrating", () => {
        render(
            <Transcript
                turns={[]}
                isHydrating={true}
                expiredBanner={false}
                emptyReason="new"
                onFollowUp={noop}
                onRetry={noop}
            />,
        );
        expect(
            screen.queryByText(/conversation cleared/i),
        ).not.toBeInTheDocument();
        expect(
            screen.queryByRole("heading", {
                level: 1,
                name: /ask the archive/i,
            }),
        ).not.toBeInTheDocument();
    });
});
