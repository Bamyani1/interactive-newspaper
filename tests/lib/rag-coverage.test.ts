import { describe, expect, it } from "vitest";
import {
    applyCoverageAnswerPolicy,
    buildCoveragePromptBlock,
    describeCoverageScope,
    type ArchiveCoverage,
} from "@/src/lib/rag-coverage";

function coverage(
    overrides: Partial<ArchiveCoverage> = {},
): ArchiveCoverage {
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
            "42 indexed editions dated 1960-01-07 through 1969-12-18, containing 1,234 searchable articles",
        );
    });

    it("labels coverage metadata as non-evidence in the model prompt", () => {
        const prompt = buildCoveragePromptBlock(
            coverage({ intent: "count", category: "Sports" }),
        );
        expect(prompt).toContain("not factual evidence");
        expect(prompt).toContain("42 indexed editions");
        expect(prompt).toContain("Sports category");
        expect(prompt).toContain("positive historical claim still requires a cited article");
    });

    it("replaces an unsupported absence claim with deterministic no-evidence wording", () => {
        const answer = applyCoverageAnswerPolicy(
            "The event definitely never happened.",
            0,
            coverage(),
        );
        expect(answer).toContain("No matching evidence was found");
        expect(answer).toContain("42 indexed editions");
        expect(answer).toContain("does not establish");
        expect(answer).not.toContain("definitely never happened");
    });

    it("preserves a cited positive answer and adds scope without changing confidence", () => {
        const original = "The cited article documented the event [Source 1].";
        const answer = applyCoverageAnswerPolicy(
            original,
            1,
            coverage({ intent: "exhaustive" }),
        );
        expect(answer).toContain(original);
        expect(answer).toContain("Coverage note:");
        expect(answer).toContain("claims above rely on the cited archive evidence");
    });

    it("does nothing for an ordinary question without coverage metadata", () => {
        expect(applyCoverageAnswerPolicy("Answer [Source 1].", 1)).toBe(
            "Answer [Source 1].",
        );
        expect(buildCoveragePromptBlock()).toBe("");
    });
});
