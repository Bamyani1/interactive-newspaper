import React from "react";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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

  it("shows restoration status without replacing the meaningful empty state", () => {
    render(
      <Transcript
        turns={[]}
        isHydrating={true}
        expiredBanner={false}
        emptyReason={null}
        onFollowUp={noop}
        onRetry={noop}
      />
    );
    expect(screen.getByText(/checking for a saved conversation/i)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: /what did students say/i,
      })
    ).toBeInTheDocument();
    screen.getAllByRole("button").forEach((button) => expect(button).toBeDisabled());
    expect(screen.queryByText(/all threads cleared/i)).not.toBeInTheDocument();
  });

  it("shows the 'All threads cleared' pill above the landing, not instead of it", () => {
    render(
      <Transcript
        turns={[]}
        isHydrating={false}
        expiredBanner={false}
        emptyReason="cleared"
        onFollowUp={noop}
        onRetry={noop}
      />
    );
    expect(screen.getByText(/all threads cleared/i)).toBeInTheDocument();
    // The landing renders under it. Clearing used to leave a bare pill in
    // an otherwise empty scroller, with nothing to click and no way to see
    // what the archive could answer.
    expect(
      screen.getByRole("heading", { level: 1, name: /what did students say/i })
    ).toBeInTheDocument();
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
      />
    );
    // The inline landing content is present — H1, lede, stats.
    expect(
      screen.getByRole("heading", { level: 1, name: /what did students say/i })
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/suggested questions, refreshed daily/i)).toBeInTheDocument();
    // Cleared pill must NOT double up.
    expect(screen.queryByText(/all threads cleared/i)).not.toBeInTheDocument();
  });

  it("shows both notices, and the landing, when a cleared transcript has also aged out", () => {
    render(
      <Transcript
        turns={[]}
        isHydrating={false}
        expiredBanner={true}
        emptyReason="cleared"
        onFollowUp={noop}
        onRetry={noop}
      />
    );
    // This combination used to match no branch at all: the pill was
    // suppressed by the banner and the landing was suppressed by the
    // cleared reason, so the reader got an entirely blank scroller.
    expect(screen.getByText(/all threads cleared/i)).toBeInTheDocument();
    expect(
      screen.getByText(/server memory for this conversation has aged out/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: /what did students say/i })
    ).toBeInTheDocument();
  });

  it("offers a way back to the latest answer once the reader scrolls away", () => {
    const turn = {
      id: "t-1",
      question: "Q",
      answer: "A long answer.",
      status: "done" as const,
      sourceArticles: [],
      citations: [],
      meta: null,
      confidence: "high" as const,
      requestId: "",
      mode: "text" as const,
      createdAt: 0,
    };
    const { container } = render(
      <Transcript
        turns={[turn]}
        isHydrating={false}
        expiredBanner={false}
        emptyReason={null}
        onFollowUp={noop}
        onRetry={noop}
      />
    );
    const scroller = container.querySelector<HTMLElement>(".ask-transcript");
    expect(scroller).not.toBeNull();
    // Nothing to return to while the reader is already at the bottom.
    expect(
      screen.queryByRole("button", { name: /scroll to the latest answer/i })
    ).not.toBeInTheDocument();

    // jsdom reports zero for every scroll metric, so the distance from the
    // bottom has to be staged before the scroll event fires.
    Object.defineProperty(scroller, "scrollHeight", { value: 2000, configurable: true });
    Object.defineProperty(scroller, "clientHeight", { value: 500, configurable: true });
    (scroller as HTMLElement).scrollTop = 0;
    fireEvent.scroll(scroller as HTMLElement);

    expect(screen.getByRole("button", { name: /scroll to the latest answer/i })).toBeInTheDocument();
  });

  it("keeps the inline landing mounted while hydrating", () => {
    render(
      <Transcript
        turns={[]}
        isHydrating={true}
        expiredBanner={false}
        emptyReason="new"
        onFollowUp={noop}
        onRetry={noop}
      />
    );
    expect(screen.queryByText(/all threads cleared/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: /what did students say/i,
      })
    ).toBeInTheDocument();
  });
});
