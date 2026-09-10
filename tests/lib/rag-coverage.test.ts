import { describe, expect, it } from "vitest";
import {
  applyCoverageAnswerPolicy,
  buildCoveragePromptBlock,
  describeCoverageScope,
  type ArchiveCoverage,
} from "@/src/lib/rag-coverage";

function coverage(overrides: Partial<ArchiveCoverage> = {}): ArchiveCoverage {
  return {
    intent: "absence",
    editionCount: 42,
    articleCount: 1_234,
    earliestEditionDate: "1960-01-07",
    latestEditionDate: "1969-12-18",
    corpusVersion: "corpus-v1",
    retrievalTarget: "legacy",
    ...overrides,
  };
}

describe("RAG coverage semantics", () => {
  it("describes the actual indexed date and article scope", () => {
    expect(describeCoverageScope(coverage())).toBe(
      "42 indexed editions dated 1960-01-07 through 1969-12-18, containing 1,234 searchable articles"
    );
  });

  // "The 1960s versus the 1990s" as one span counts the 1970s and 1980s,
  // which is most of the archive and no part of the question.
  it("describes each compared period instead of the span between them", () => {
    const compared = coverage({
      intent: "comparison",
      periods: [
        { startDate: "1960-01-01", endDate: "1969-12-31", editionCount: 27, articleCount: 1_390 },
        { startDate: "1990-01-01", endDate: "1991-12-31", editionCount: 19, articleCount: 480 },
      ],
    });
    expect(describeCoverageScope(compared)).toBe(
      "1960–1969: 27 indexed editions containing 1,390 searchable articles; 1990–1991: 19 indexed editions containing 480 searchable articles"
    );
    expect(describeCoverageScope({ ...compared, category: "Sports" })).toMatch(
      /480 searchable articles \(Sports category\)$/
    );
  });

  // A comparison answer once weighed a column and a comic strip against
  // seven articles and called the difference a historical finding.
  it("tells the model to weigh each compared period's evidence separately", () => {
    const prompt = buildCoveragePromptBlock(
      coverage({
        intent: "comparison",
        periods: [
          { startDate: "1960-01-01", endDate: "1969-12-31", editionCount: 27, articleCount: 1_390 },
          { startDate: "1990-01-01", endDate: "1991-12-31", editionCount: 19, articleCount: 480 },
        ],
      })
    );
    expect(prompt).toContain("Coverage intent: comparison");
    expect(prompt).toContain("Weigh each period's evidence separately");
    expect(prompt).toContain("a limit of this archive");
    expect(buildCoveragePromptBlock(coverage())).not.toContain("Weigh each period");
  });

  it("labels coverage metadata as non-evidence in the model prompt", () => {
    const prompt = buildCoveragePromptBlock(coverage({ intent: "count", category: "Sports" }));
    expect(prompt).toContain("not factual evidence");
    expect(prompt).toContain("42 indexed editions");
    expect(prompt).toContain("Sports category");
    expect(prompt).toContain("positive historical claim still requires a cited article");
  });

  it("includes the year digest as non-citable guidance when present", () => {
    const withDigest = buildCoveragePromptBlock(
      coverage({ intent: "exhaustive", yearDigest: "**January**\n* Jan. 24: Benz named provost." })
    );
    expect(withDigest).toContain("YEAR DIGEST");
    expect(withDigest).toContain("Benz named provost");
    expect(withDigest).toContain("Never cite the digest");
    const withoutDigest = buildCoveragePromptBlock(coverage({ intent: "exhaustive" }));
    expect(withoutDigest).not.toContain("YEAR DIGEST");
  });

  it("replaces an unsupported absence claim with deterministic no-evidence wording", () => {
    const answer = applyCoverageAnswerPolicy("The event definitely never happened.", 0, coverage());
    expect(answer).toContain("No matching evidence was found");
    expect(answer).toContain("42 indexed editions");
    expect(answer).toContain("does not establish");
    expect(answer).not.toContain("definitely never happened");
  });

  // Scope reaches the reader as meta.coverage, which the transcript renders
  // above the answer. Appending it as prose put a paragraph of metadata in
  // the answer's own voice under every reply, which read as filler.
  it("returns a cited positive answer verbatim, with no scope paragraph", () => {
    const original = "The cited article documented the event [Source 1].";
    const answer = applyCoverageAnswerPolicy(original, 1, coverage({ intent: "exhaustive" }));
    expect(answer).toBe(original);
    expect(answer).not.toContain("Coverage note:");
  });

  it("does nothing for an ordinary question without coverage metadata", () => {
    expect(applyCoverageAnswerPolicy("Answer [Source 1].", 1)).toBe("Answer [Source 1].");
    expect(buildCoveragePromptBlock()).toBe("");
  });
});
