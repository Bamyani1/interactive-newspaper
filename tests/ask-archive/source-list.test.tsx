import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SourceList } from "@/features/ask-archive";
import type { AskResponse } from "@/src/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

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
  } as SourceArticle;
}

describe("SourceList", () => {
  it("renders source cards when expanded (default)", () => {
    const sources = [makeSource(), makeSource({ id: "1960-01-07-1", headline: "Second Article" })];
    render(<SourceList sources={sources} turnId="t-1" />);

    expect(screen.getByText(/Test Article/)).toBeInTheDocument();
    expect(screen.getByText(/Second Article/)).toBeInTheDocument();
  });

  it("shows the correct source count in the toggle button", () => {
    const sources = [makeSource(), makeSource({ id: "1960-01-07-1", headline: "Second Article" })];
    render(<SourceList sources={sources} turnId="t-1" />);

    expect(screen.getByRole("button", { name: /sources — 2 articles/i })).toBeInTheDocument();
  });

  it("shows singular 'article' for single source", () => {
    render(<SourceList sources={[makeSource()]} turnId="t-1" />);

    expect(screen.getByRole("button", { name: /sources — 1 article/i })).toBeInTheDocument();
  });

  it("collapses and expands on toggle click", () => {
    const sources = [makeSource()];
    render(<SourceList sources={sources} turnId="t-1" />);

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
    const { container } = render(<SourceList sources={[]} turnId="t-1" />);

    expect(container.innerHTML).toBe("");
  });

  it("shows headline, category, date, and snippet on source cards", () => {
    const source = makeSource({
      headline: "Phone Fraud Story",
      category: "News",
      editionDate: "1960-02-03",
      bodySnippet: "Students were fined for phone fraud...",
    });
    render(<SourceList sources={[source]} turnId="t-1" />);

    expect(screen.getByText(/Phone Fraud Story/)).toBeInTheDocument();
    expect(screen.getByText("News")).toBeInTheDocument();
    expect(screen.getByText("1960-02-03")).toBeInTheDocument();
    expect(screen.getByText("Students were fined for phone fraud...")).toBeInTheDocument();
  });

  it("renders headline with source index prefix", () => {
    const sources = [
      makeSource({ headline: "First Story" }),
      makeSource({ id: "1960-01-07-1", headline: "Second Story" }),
    ];
    render(<SourceList sources={sources} turnId="t-1" />);

    expect(screen.getByText("[1]")).toBeInTheDocument();
    expect(screen.getByText("[2]")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /First Story/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Second Story/ })).toBeInTheDocument();
  });

  it("gives each card a real Read control instead of being one itself", () => {
    const source = makeSource({ editionDate: "1960-02-03" });
    render(<SourceList sources={[source]} turnId="t-1" />);

    // The card carried role="button" on an <article>, which flattened the
    // index, headline, byline, snippet and photo count into one accessible
    // name and stopped the headline being a heading.
    const read = screen.getByRole("button", { name: "Read: Test Article" });
    expect(read.tagName).toBe("BUTTON");
    expect(screen.getByRole("heading", { name: /Test Article/ })).toBeInTheDocument();

    // The id is scoped to its turn: `ask-source-1` repeated across every
    // turn, so a citation in a later answer scrolled to the first answer.
    const card = read.closest("article");
    expect(card).toHaveAttribute("id", "ask-source-t-1-1");
    expect(card).not.toHaveAttribute("role");
    expect(card).not.toHaveAttribute("tabIndex");
  });

  it("the Read control opens the article reader", () => {
    render(<SourceList sources={[makeSource({ headline: "Trustees Vote" })]} turnId="t-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Read: Trustees Vote" }));
    expect(screen.getByRole("dialog", { name: /Trustees Vote/ })).toBeInTheDocument();
  });
});
