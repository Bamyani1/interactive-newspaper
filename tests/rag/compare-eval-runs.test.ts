/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import {
  compareRuns,
  mcnemarExact,
  minimumDetectableEffect,
} from "../../scripts/rag/compare-eval-runs";
import type { EvalRunFile, EvalRunRecord } from "../../scripts/rag/lib/eval-records";

const record = (questionId: string, text: string, citations: string[]) =>
  ({
    questionId,
    answer: { text, citations, images: [], confidence: null, followUps: [] },
  }) as unknown as EvalRunRecord;
const runFile = (records: EvalRunRecord[]) => ({ records }) as unknown as EvalRunFile;

describe("mcnemarExact", () => {
  it("is the two-sided exact binomial p on the discordant pairs", () => {
    expect(mcnemarExact(0, 0)).toBe(1);
    expect(mcnemarExact(5, 0)).toBeCloseTo(0.0625, 12);
    expect(mcnemarExact(0, 5)).toBeCloseTo(0.0625, 12);
    expect(mcnemarExact(3, 3)).toBe(1);
  });
});

describe("minimumDetectableEffect", () => {
  it("is (z.975 + z.80) times the standard error of the paired differences", () => {
    const sd = Math.sqrt((4 * 0.01) / 3);
    expect(minimumDetectableEffect([0.1, -0.1, 0.1, -0.1])).toBeCloseTo((2.801585 * sd) / 2, 5);
  });
});

describe("compareRuns", () => {
  const evidence = {
    datasetId: "d",
    split: "development",
    questions: [
      { id: "q1", expectedFactsAny: [["Gray Chapel"], ["1961"]], expectedSourceIdsAny: ["a1"] },
      { id: "q2", expectedFactsAny: [["Bashford"]], expectedSourceIdsAny: ["a2"] },
      { id: "q3", expectedSourceIdsAny: ["a3"] },
    ],
  };
  const a = runFile([
    record("q1", "It met in Gray Chapel in 1961.", ["a1"]),
    record("q2", "No record found.", []),
    record("q3", "See the story.", ["a3"]),
  ]);
  const b = runFile([
    record("q1", "It met in Gray Chapel.", ["a1"]),
    record("q2", "Bashford Hall hosted it.", ["a2"]),
    record("q3", "See the story.", ["a3"]),
  ]);

  it("counts per-question pass flips in both directions", () => {
    const result = compareRuns(a, b, evidence, { seed: 1 });
    // q1 passes in A only, q2 in B only, q3 in both (its source is cited).
    expect(result.n).toBe(3);
    expect(result.mcnemar).toMatchObject({ aOnly: 1, bOnly: 1 });
    expect(result.disagreement).toBeCloseTo(2 / 3, 12);
  });

  it("compares mean fact recall over the questions with facts", () => {
    const result = compareRuns(a, b, evidence, { seed: 1 });
    expect(result.factRecall.a).toBeCloseTo(0.5, 12);
    expect(result.factRecall.b).toBeCloseTo(0.75, 12);
    expect(result.factRecall.ci.n).toBe(2);
  });
});
