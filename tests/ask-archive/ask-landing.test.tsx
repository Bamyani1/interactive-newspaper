import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AskLanding } from "@/features/ask-archive/components/AskLanding";
import { pickDailyQuestion } from "@/features/ask-archive/data/question-pool";

describe("AskLanding", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the kicker, hero, lede, and provenance strip", () => {
    render(<AskLanding onPickQuestion={vi.fn()} />);

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent(/What did students say\?/);

    // Kicker carries the archive's span.
    expect(screen.getByText(/Primary-source research/i)).toBeInTheDocument();

    // Lede orients the reader without over-promising.
    expect(screen.getByText(/Search more than five decades of/i)).toBeInTheDocument();

    // Provenance strip: the standing verification disclaimer survives
    // the redesign — answers are generated over OCR'd historical text.
    expect(
      screen.getByText(
        /Answers cite primary sources\. Always verify\. · 351 editions · 11,705 articles/
      )
    ).toBeInTheDocument();
  });

  it("does NOT render the demo card, dateline, or expired notice", () => {
    render(<AskLanding onPickQuestion={vi.fn()} />);

    // Regression guards — earlier iterations shipped these; v2.1 removed
    // the demo card + dateline + expired notice because they duplicated
    // scope, shouted over the H1, or cluttered the hero.
    expect(screen.queryByLabelText(/example of how an answer looks/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Example answer/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Research Desk · Vol\. LVI/)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/server memory for this conversation has aged out/i)
    ).not.toBeInTheDocument();
  });

  it("renders three daily suggestions and fires onPickQuestion on click", () => {
    const onPick = vi.fn();
    render(<AskLanding onPickQuestion={onPick} />);

    const list = screen.getByLabelText(/suggested questions, refreshed daily/i);
    const buttons = list.querySelectorAll<HTMLButtonElement>(".ask-landing-suggestion");
    expect(buttons).toHaveLength(3);

    // The homepage teaser's question of the day is excluded, so a
    // reader arriving from it is never offered the same prompt twice.
    const daily = pickDailyQuestion(new Date("2000-01-01T12:00:00.000Z"));
    buttons.forEach((btn) => {
      expect(btn.textContent).not.toContain(daily);
    });

    // Each row is labelled with the research lens it represents.
    buttons.forEach((btn) => {
      const lens = btn.querySelector(".ask-landing-suggestion-lens");
      expect(lens?.textContent ?? "").not.toEqual("");
    });

    fireEvent.click(buttons[0]);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0][0]).toEqual(expect.stringMatching(/.+\?|.+\./));
  });

  it("keeps suggestions visible but inert during session restoration", () => {
    const onPick = vi.fn();
    render(<AskLanding onPickQuestion={onPick} disabled />);

    const suggestions = screen.getAllByRole("button");
    expect(suggestions).toHaveLength(3);
    suggestions.forEach((suggestion) => {
      expect(suggestion).toBeDisabled();
      fireEvent.click(suggestion);
    });
    expect(onPick).not.toHaveBeenCalled();
    expect(document.querySelector(".ask-landing")).not.toHaveAttribute("data-animate");
  });
});
