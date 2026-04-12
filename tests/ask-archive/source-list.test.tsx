import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SourceList } from "@/features/ask-archive";
import type { AskResponse } from "@/src/types";

type SourceArticle = AskResponse["sourceArticles"][number];

function makeSource(overrides: Partial<SourceArticle> = {}): SourceArticle {
  return {
    id: "1960-01-07-0",
    headline: "Test Article",
    editionDate: "1960-01-07",
    category: "News",
    summary: "Test summary",
    byline: "Test Author",
    bodySnippet: "This is a snippet of the article body...",
    distance: 0.25,
    imageUrls: [],
    ...overrides,
  };
}

describe("SourceList", () => {
  it("renders source cards when expanded (default)", () => {
    const sources = [
      makeSource(),
      makeSource({ id: "1960-01-07-1", headline: "Second Article" }),
    ];
    render(<SourceList sources={sources} />);

    expect(screen.getByText(/Test Article/)).toBeInTheDocument();
    expect(screen.getByText(/Second Article/)).toBeInTheDocument();
  });

  it("shows the correct source count in the toggle button", () => {
    const sources = [
      makeSource(),
      makeSource({ id: "1960-01-07-1", headline: "Second Article" }),
    ];
    render(<SourceList sources={sources} />);

    expect(
      screen.getByRole("button", { name: /sources \(2 articles\)/i })
    ).toBeInTheDocument();
  });

  it("shows singular 'article' for single source", () => {
    render(<SourceList sources={[makeSource()]} />);

    expect(
      screen.getByRole("button", { name: /sources \(1 article\)/i })
    ).toBeInTheDocument();
  });

  it("collapses and expands on toggle click", () => {
    const sources = [makeSource()];
    render(<SourceList sources={sources} />);

    const toggle = screen.getByRole("button", { name: /sources/i });
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/Test Article/)).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/Test Article/)).toBeInTheDocument();
  });

  it("returns null when sources array is empty", () => {
    const { container } = render(<SourceList sources={[]} />);

    expect(container.innerHTML).toBe("");
  });

  it("shows headline, category, date, and snippet on source cards", () => {
    const source = makeSource({
      headline: "Phone Fraud Story",
      category: "News",
      editionDate: "1960-02-03",
      bodySnippet: "Students were fined for phone fraud...",
    });
    render(<SourceList sources={[source]} />);

    expect(screen.getByText(/Phone Fraud Story/)).toBeInTheDocument();
    expect(screen.getByText("News")).toBeInTheDocument();
    expect(screen.getByText("1960-02-03")).toBeInTheDocument();
    expect(
      screen.getByText("Students were fined for phone fraud...")
    ).toBeInTheDocument();
  });

  it("renders headline with source index prefix", () => {
    const sources = [
      makeSource({ headline: "First Story" }),
      makeSource({ id: "1960-01-07-1", headline: "Second Story" }),
    ];
    render(<SourceList sources={sources} />);

    expect(screen.getByText("[1] First Story")).toBeInTheDocument();
    expect(screen.getByText("[2] Second Story")).toBeInTheDocument();
  });

  it("links each source card to its edition page", () => {
    const source = makeSource({ editionDate: "1960-02-03" });
    render(<SourceList sources={[source]} />);

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/edition/1960-02-03");
  });
});
