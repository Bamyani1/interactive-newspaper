/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import {
  formatSheet,
  parseSheet,
  validateJudge,
  applyVital,
} from "../../scripts/rag/lib/label-sheet";

describe("label sheets", () => {
  const items = [
    {
      id: "S:q1:0",
      body: "**Sentence:** It rained.",
      choices: ["full", "partial", "none", "no_claim"],
    },
    {
      id: "N:q1:1",
      body: "**Fact:** 43-41",
      choices: ["supported", "partial", "unsupported"],
      prefill: "partial",
    },
  ];

  it("reads back the labels written on the sheet, skipping blanks", () => {
    const sheet = formatSheet("Judge check", "Label each item.", items);
    expect(parseSheet(sheet)).toEqual(new Map([["N:q1:1", "partial"]]));
    const filled = sheet.replace(
      "Label (full / partial / none / no_claim):",
      "Label (full / partial / none / no_claim): none"
    );
    expect(parseSheet(filled)).toEqual(
      new Map([
        ["S:q1:0", "none"],
        ["N:q1:1", "partial"],
      ])
    );
  });

  it("rejects a label outside the item's choices", () => {
    const sheet = formatSheet("t", "i", items).replace("): partial", "): maybe");
    expect(() => parseSheet(sheet)).toThrow(/N:q1:1.*maybe/);
  });
});

describe("validateJudge", () => {
  it("reports TPR and TNR with full/supported as the positive class", () => {
    const owner = new Map([
      ["a", "full"],
      ["b", "full"],
      ["c", "none"],
      ["d", "partial"],
      ["e", "no_claim"],
      ["f", "supported"],
    ]);
    const judge = new Map([
      ["a", "full"],
      ["b", "partial"],
      ["c", "none"],
      ["d", "full"],
      ["e", "no_claim"],
      ["f", "supported"],
    ]);
    const result = validateJudge(owner, judge);
    // Positives a, b, f: judge agrees on a, f. Negatives c, d: judge agrees on c. e is not a claim.
    expect(result).toMatchObject({ n: 6, exact: 4 / 6, positives: 3, negatives: 2 });
    expect(result.tpr).toBeCloseTo(2 / 3, 12);
    expect(result.tnr).toBeCloseTo(1 / 2, 12);
    expect(result.passes).toBe(false);
  });

  it("only counts items both sides labeled", () => {
    expect(validateJudge(new Map([["a", "full"]]), new Map([["b", "full"]])).n).toBe(0);
  });
});

describe("applyVital", () => {
  it("writes the owner's vital marks onto each question's fact groups", () => {
    const catalog: {
      questions: { id: string; expectedFactsAny: string[][]; expectedFactsVital?: boolean[] }[];
    } = {
      questions: [
        { id: "q1", expectedFactsAny: [["a"], ["b"], ["c"]] },
        { id: "q2", expectedFactsAny: [["d"]] },
      ],
    };
    const marked = applyVital(
      catalog,
      new Map([
        ["V:q1:1", "optional"],
        ["V:q1:2", "vital"],
      ])
    );
    expect(marked.questions[0].expectedFactsVital).toEqual([true, false, true]);
    expect(marked.questions[1].expectedFactsVital).toBeUndefined();
  });
});
