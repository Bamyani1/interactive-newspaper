import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AnswerPanel } from "@/features/ask-archive";
import type { AskResponse } from "@/src/types";

function makeResponse(overrides: Partial<AskResponse> = {}): AskResponse {
  return {
    question: "What happened?",
    answer: "Something happened [Source 1] and then more [Source 2].",
    citations: [
      { articleId: "1960-01-07-0", headline: "Article One", editionDate: "1960-01-07" },
      { articleId: "1960-01-07-1", headline: "Article Two", editionDate: "1960-01-07" },
    ],
    confidence: "high",
    sourceArticles: [
      {
        id: "1960-01-07-0",
        headline: "Article One",
        editionDate: "1960-01-07",
        category: "News",
        summary: "Summary one",
        byline: "Author",
        bodySnippet: "Body text...",
        distance: 0.25,
      },
    ],
    meta: {
      retrievalTimeMs: 150,
      generationTimeMs: 800,
      totalTimeMs: 950,
      articlesSearched: 8,
      method: "hybrid",
    },
    ...overrides,
  };
}

describe("AnswerPanel", () => {
  it("renders the answer text", () => {
    render(<AnswerPanel response={makeResponse()} />);

    expect(screen.getByText(/Something happened/)).toBeInTheDocument();
  });

  it("renders citation links with correct hrefs", () => {
    render(<AnswerPanel response={makeResponse()} />);

    const citationLinks = screen.getAllByRole("link");
    const link1 = citationLinks.find((el) => el.textContent === "[1]");
    const link2 = citationLinks.find((el) => el.textContent === "[2]");

    expect(link1).toHaveAttribute("href", "#ask-source-1");
    expect(link2).toHaveAttribute("href", "#ask-source-2");
  });

  it("hides answer text and cursor when not streaming with empty answer", () => {
    render(<AnswerPanel response={makeResponse({ answer: "" })} />);

    expect(screen.queryByText(/▊/)).not.toBeInTheDocument();
  });

  it("renders ### headings as h3 (not raw hashes)", () => {
    const answer =
      "Intro paragraph.\n\n### Sub-section one\n\nMore text [Source 1].";
    render(<AnswerPanel response={makeResponse({ answer })} />);

    expect(screen.queryByText(/###/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 3, name: "Sub-section one" }),
    ).toBeInTheDocument();
  });

  it("also renders ## headings (regression: the 2–6 hash range)", () => {
    const answer = "Prelude.\n\n## A Section\n\nContent [Source 1].";
    render(<AnswerPanel response={makeResponse({ answer })} />);

    expect(
      screen.getByRole("heading", { level: 3, name: "A Section" }),
    ).toBeInTheDocument();
  });

  it("strips leading '* ' bullet markers from lines", () => {
    const answer =
      "Overview:\n\n* First point with a citation [Source 1].\n* Second point [Source 2].";
    const { container } = render(<AnswerPanel response={makeResponse({ answer })} />);

    // The rendered paragraph should NOT start with a bare asterisk.
    const paragraphs = container.querySelectorAll("p");
    const bulletTexts = Array.from(paragraphs).map((p) => p.textContent ?? "");
    for (const t of bulletTexts) {
      expect(t.trimStart().startsWith("* ")).toBe(false);
      expect(t.trimStart().startsWith("- ")).toBe(false);
    }
    expect(container.textContent).toContain("First point");
    expect(container.textContent).toContain("Second point");
  });

  it("strips leading '- ' bullet markers from lines", () => {
    const answer = "Topics:\n\n- Dash one [Source 1].\n- Dash two.";
    const { container } = render(<AnswerPanel response={makeResponse({ answer })} />);

    expect(container.textContent).toContain("Dash one");
    expect(container.textContent).toContain("Dash two");
    const paragraphs = container.querySelectorAll("p");
    for (const p of Array.from(paragraphs)) {
      expect((p.textContent ?? "").trimStart().startsWith("- ")).toBe(false);
    }
  });

  it("does not italicize spans longer than 80 chars (greedy *...* guard)", () => {
    const longSpan = "*" + "x".repeat(100) + "*";
    const answer = `Before. ${longSpan} After [Source 1].`;
    const { container } = render(<AnswerPanel response={makeResponse({ answer })} />);

    // The <em> element should NOT contain the long run. Asterisks may be
    // rendered literally — that's the documented fallback behavior.
    const ems = container.querySelectorAll("em");
    for (const em of Array.from(ems)) {
      expect((em.textContent ?? "").length).toBeLessThanOrEqual(80);
    }
  });

  it("italicizes short inline *span* correctly", () => {
    const answer = "Here is *an emphasis* in text [Source 1].";
    const { container } = render(<AnswerPanel response={makeResponse({ answer })} />);

    const em = container.querySelector("em");
    expect(em).not.toBeNull();
    expect(em?.textContent).toBe("an emphasis");
  });
});
