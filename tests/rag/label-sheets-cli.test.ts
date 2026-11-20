/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { judgeLabelsById, vitalSheetItems } from "../../scripts/rag/label-sheets";
import type { JudgedRun } from "../../scripts/rag/judge-eval";

describe("judgeLabelsById", () => {
  it("keys sentence and fact labels the way the owner sheet does", () => {
    const judged = {
      questions: [
        {
          questionId: "q1",
          nuggets: [
            { index: 0, phrases: ["a"], vital: true, echo: true },
            { index: 1, phrases: ["b"], vital: true, echo: false, label: "partial" },
          ],
          sentences: [{ text: "s", cited: ["x"], uncited: false, label: "full" }],
        },
      ],
    } as unknown as JudgedRun;
    expect(judgeLabelsById(judged)).toEqual(
      new Map([
        ["S:q1:0", "full"],
        ["N:q1:1", "partial"],
      ])
    );
  });
});

describe("vitalSheetItems", () => {
  it("lists every non-echo fact group, pre-filled vital", () => {
    const items = vitalSheetItems({
      questions: [{ id: "q1", question: "Was it at Gray Chapel?", expectedFactsAny: [["Gray Chapel"], ["1968"]] }],
    });
    expect(items.map((i) => [i.id, i.prefill])).toEqual([["V:q1:1", "vital"]]);
    expect(items[0].body).toContain('"1968"');
  });
});
