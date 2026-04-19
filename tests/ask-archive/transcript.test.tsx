import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Transcript } from "@/features/ask-archive/components/Transcript";

// `SourceReader` (a descendant of `Turn → SourceList → SourceReader`) touches
// next/navigation's useRouter. We're rendering Transcript with turns=[] in
// these tests so nothing should actually reach into the router, but the
// import graph still evaluates the hook call paths — mock it to keep the
// test environment honest.
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
                onFollowUp={noop}
                onRetry={noop}
            />,
        );
        expect(
            screen.getByText(/restoring conversation/i),
        ).toBeInTheDocument();
        // Cleared indicator must not double-up with the hydrating one.
        expect(
            screen.queryByText(/conversation cleared/i),
        ).not.toBeInTheDocument();
    });

    it("shows the 'Conversation cleared' indicator when empty and not hydrating", () => {
        render(
            <Transcript
                turns={[]}
                isHydrating={false}
                expiredBanner={false}
                onFollowUp={noop}
                onRetry={noop}
            />,
        );
        expect(
            screen.getByText(/conversation cleared/i),
        ).toBeInTheDocument();
        expect(
            screen.queryByText(/restoring conversation/i),
        ).not.toBeInTheDocument();
    });

    it("hides the cleared indicator when the expired banner is showing", () => {
        render(
            <Transcript
                turns={[]}
                isHydrating={false}
                expiredBanner={true}
                onFollowUp={noop}
                onRetry={noop}
            />,
        );
        // Expired banner is the primary status when the session expired —
        // the cleared indicator shouldn't compete for attention.
        expect(
            screen.queryByText(/conversation cleared/i),
        ).not.toBeInTheDocument();
        expect(
            screen.getByText(/your last conversation expired/i),
        ).toBeInTheDocument();
    });

    it("hides the cleared indicator while hydrating even if no turns yet", () => {
        render(
            <Transcript
                turns={[]}
                isHydrating={true}
                expiredBanner={false}
                onFollowUp={noop}
                onRetry={noop}
            />,
        );
        expect(
            screen.queryByText(/conversation cleared/i),
        ).not.toBeInTheDocument();
    });
});
