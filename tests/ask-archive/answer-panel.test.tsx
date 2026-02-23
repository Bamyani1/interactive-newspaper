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

  it("shows the confidence badge", () => {
    render(<AnswerPanel response={makeResponse({ confidence: "high" })} />);

    expect(screen.getByText("High confidence")).toBeInTheDocument();
  });

  it("shows meta information", () => {
    render(<AnswerPanel response={makeResponse()} />);

    expect(screen.getByText("8 articles searched")).toBeInTheDocument();
    expect(screen.getByText(/0\.9/)).toBeInTheDocument();
  });
});
