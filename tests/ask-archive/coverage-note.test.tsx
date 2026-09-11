/**
 * The scope line above an answer.
 *
 * The archive holds roughly one issue in eight of a paper that ran for
 * 57 years, so a thin answer is often a thin slice rather than a broken
 * pipeline. This is where the reader is told which one they are looking
 * at — before the answer, not in a paragraph appended after it.
 */

import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CoverageNote } from "@/features/ask-archive/components/CoverageNote";
import type { AskResponse } from "@/src/types";

type Coverage = NonNullable<AskResponse["meta"]["coverage"]>;

function coverage(overrides: Partial<Coverage> = {}): Coverage {
  return {
    intent: "exhaustive",
    editionCount: 216,
    articleCount: 7393,
    earliestEditionDate: "1960-01-13",
    latestEditionDate: "1989-10-25",
    ...overrides,
  };
}

describe("CoverageNote", () => {
  it("names the scope that was searched, with thousands separated", () => {
    render(<CoverageNote coverage={coverage()} />);
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent("216 issues from 1960–1989");
    expect(note).toHaveTextContent("7,393 articles");
  });

  // Without this the number reads as the whole newspaper, which is the
  // opposite of what it means.
  it("says the scope is the indexed subset, not the whole paper", () => {
    render(<CoverageNote coverage={coverage()} />);
    expect(screen.getByRole("note")).toHaveTextContent(
      "That is the indexed scope, not everything the paper printed."
    );
  });

  it("collapses a single-year span to one year", () => {
    render(
      <CoverageNote
        coverage={coverage({
          earliestEditionDate: "1962-02-01",
          latestEditionDate: "1962-11-30",
          editionCount: 1,
          articleCount: 1,
        })}
      />
    );
    expect(screen.getByRole("note")).toHaveTextContent("1 issue from 1962 · 1 article");
  });

  // One span over "the 1960s versus the 1990s" counted the 1970s and 1980s
  // too: most of the archive, and no part of the question.
  it("gives each compared period its own count", () => {
    render(
      <CoverageNote
        coverage={coverage({
          intent: "comparison",
          editionCount: 271,
          periods: [
            {
              startDate: "1960-01-01",
              endDate: "1969-12-31",
              editionCount: 27,
              articleCount: 1390,
            },
            { startDate: "1990-01-01", endDate: "1991-12-31", editionCount: 19, articleCount: 480 },
          ],
        })}
      />
    );
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent("Searched 1960–1969: 27 issues · 1990–1991: 19 issues.");
    expect(note).not.toHaveTextContent("271");
  });

  it("names a category filter when the question carried one", () => {
    render(<CoverageNote coverage={coverage({ category: "Sports" })} />);
    expect(screen.getByRole("note")).toHaveTextContent("in Sports");
  });

  // Most questions carry no coverage intent, and an empty scope is not
  // something to announce — it renders nothing rather than "0 issues".
  it("renders nothing without coverage, or with an empty scope", () => {
    const { container, rerender } = render(<CoverageNote />);
    expect(container).toBeEmptyDOMElement();
    rerender(<CoverageNote coverage={coverage({ editionCount: 0 })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("survives a scope with no dated editions", () => {
    render(
      <CoverageNote coverage={coverage({ earliestEditionDate: null, latestEditionDate: null })} />
    );
    expect(screen.getByRole("note")).toHaveTextContent("216 issues · 7,393 articles");
  });
});
