/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import {
  compareRuns,
  judgeDirections,
  mcnemarExact,
  minimumDetectableEffect,
} from "../../scripts/rag/compare-eval-runs";
import type { JudgedRun } from "../../scripts/rag/judge-eval";
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

describe("judgeDirections", () => {
  const judged = (judge: string, support: number[]): JudgedRun =>
    ({
      judge,
      questions: support.map((s, i) => ({
        questionId: `q${i}`,
        nuggets: [],
        sentences: [],
        nuggetScore: null,
        vitalNuggetScore: null,
        supportScore: s,
      })),
    }) as unknown as JudgedRun;

  it("says the judges agree only when every judge moves the same way", () => {
    const result = judgeDirections(
      [judged("claude-haiku-5-5", [0.5, 0.5, 0.5]), judged("claude-sonnet-5-5", [0.6, 0.6, 0.6])],
      [judged("claude-haiku-5-5", [0.7, 0.6, 0.8]), judged("claude-sonnet-5-5", [0.5, 0.6, 0.6])],
      { seed: 1 }
    );
    expect(result.supportScore.byJudge["claude-haiku-5-5"].mean).toBeCloseTo(0.2, 12);
    expect(result.supportScore.byJudge["claude-sonnet-5-5"].mean).toBeCloseTo(-0.1 / 3, 12);
    expect(result.supportScore.agree).toBe(false);
    expect(result.nuggetScore.byJudge["claude-haiku-5-5"].n).toBe(0);
  });

  it("needs both runs judged by the same judges", () => {
    expect(() =>
      judgeDirections([judged("claude-haiku-5-5", [1])], [judged("claude-sonnet-5-5", [1])], { seed: 1 })
    ).toThrow(/claude-haiku-5-5/);
  });
});
