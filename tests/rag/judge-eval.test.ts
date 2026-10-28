/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import {
  judgeTargets,
  parseLabels,
  summarizeJudged,
  type JudgedQuestion,
} from "../../scripts/rag/judge-eval";
import { sampleItems } from "../../scripts/rag/lib/label-sheet";
import type { EvalRunRecord } from "../../scripts/rag/lib/eval-records";

const record = (
  text: string,
  citations: string[],
  ranked: string[],
  error: EvalRunRecord["error"] = null
) =>
  ({
    questionId: "q1",
    answer: { text, citations, images: [], confidence: null, followUps: [] },
    stages: { rerank: { status: "ok", ms: 1, rankedSourceIds: ranked } },
    error,
  }) as unknown as EvalRunRecord;

describe("judgeTargets", () => {
  const question = {
    id: "q1",
    question: "How did the team lose at Kent State?",
    expectedFactsAny: [["Kent State"], ["43-41"]],
  };

  it("gives each sentence its own citations, and uncited ones every article the answer cites", () => {
    const targets = judgeTargets(
      record("They lost 43-41 [Source 2]. It was close.", ["b"], ["a", "b"]),
      question
    );
    expect(targets.sentences).toEqual([
      { text: "They lost 43-41.", cited: ["b"], uncited: false },
      { text: "It was close.", cited: ["b"], uncited: true },
    ]);
    expect(targets.nuggets.map((n) => n.echo)).toEqual([true, false]);
  });

  it("judges no sentences when the answer cites nothing", () => {
    expect(
      judgeTargets(record("I don't have enough information.", [], ["a"]), question).sentences
    ).toEqual([]);
  });
});

describe("parseLabels", () => {
  it("accepts one allowed label per item", () => {
    expect(parseLabels('{"labels":["full","none"]}', 2, ["full", "none"])).toEqual([
      "full",
      "none",
    ]);
  });

  it("rejects a wrong count or an unknown label", () => {
    expect(() => parseLabels('{"labels":["full"]}', 2, ["full"])).toThrow(/1 labels for 2/);
    expect(() => parseLabels('{"labels":["maybe"]}', 1, ["full"])).toThrow(/maybe/);
  });
});

describe("summarizeJudged", () => {
  const q = (over: Partial<JudgedQuestion>): JudgedQuestion => ({
    questionId: "q",
    nuggets: [],
    sentences: [],
    nuggetScore: null,
    vitalNuggetScore: null,
    supportScore: null,
    ...over,
  });

  it("averages per-question scores and counts sentence rates over all claim sentences", () => {
    const metrics = summarizeJudged([
      q({
        nuggetScore: 1,
        supportScore: 0.5,
        sentences: [
          { text: "a", cited: ["x"], uncited: false, label: "full" },
          { text: "b", cited: ["x"], uncited: true, label: "none" },
        ],
      }),
      q({
        nuggetScore: 0,
        sentences: [{ text: "c", cited: ["x"], uncited: false, label: "no_claim" }],
      }),
      q({ error: "timeout" }),
    ]);
    expect(metrics).toMatchObject({
      nuggetScore: 0.5,
      vitalNuggetScore: null,
      supportScore: 0.5,
      unsupportedSentenceRate: 0.5,
      uncitedSentenceRate: 1 / 3,
      judged: 2,
      errors: 1,
    });
  });
});

describe("sampleItems", () => {
  it("draws the same items for the same seed, whatever the input order", () => {
    const items = Array.from({ length: 30 }, (_, i) => `item-${i}`);
    const first = sampleItems(items, 10, 7, (s) => s);
    expect(first).toHaveLength(10);
    expect(new Set(first).size).toBe(10);
    expect(sampleItems([...items].reverse(), 10, 7, (s) => s)).toEqual(first);
  });
});
