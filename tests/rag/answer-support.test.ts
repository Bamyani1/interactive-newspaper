/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import {
  nuggetsFor,
  splitSentences,
  sentenceCitations,
  nuggetScores,
  supportScore,
} from "../../scripts/rag/lib/answer-support";

describe("nuggetsFor", () => {
  it("flags a group whose phrases all occur in the question as an echo", () => {
    const [nugget] = nuggetsFor({
      question: "Why did Gray Chapel close in 1968?",
      expectedFactsAny: [["Gray Chapel", "1968"]],
    });
    expect(nugget.echo).toBe(true);
  });

  it("flags a group the question satisfies through any one phrase", () => {
    const nuggets = nuggetsFor({
      question: "How did the swim team lose at Kent State?",
      expectedFactsAny: [["Kent State", "Kempf"], ["43-41"]],
    });
    expect(nuggets.map((n) => n.echo)).toEqual([true, false]);
  });

  it("matches whole words, so a decade in the question doesn't echo a year", () => {
    const nuggets = nuggetsFor({
      question: "What changed for women at OWU in the 1960s, at Kent State's meet?",
      expectedFactsAny: [["1960"], ["Kent State"]],
    });
    expect(nuggets.map((n) => n.echo)).toEqual([false, true]);
  });

  it("lets a word take an ending but not start mid-word", () => {
    const nuggets = nuggetsFor({
      question: "Which New York Giants player spoke at the farmers' party?",
      expectedFactsAny: [["New York Giant"], ["farm"], ["art"]],
    });
    expect(nuggets.map((n) => n.echo)).toEqual([true, true, false]);
  });

  it("treats every group as vital until the owner marks it optional", () => {
    expect(
      nuggetsFor({ question: "Q?", expectedFactsAny: [["a"], ["b"]] }).map((n) => n.vital)
    ).toEqual([true, true]);
    expect(
      nuggetsFor({
        question: "Q?",
        expectedFactsAny: [["a"], ["b"]],
        expectedFactsVital: [true, false],
      }).map((n) => n.vital)
    ).toEqual([true, false]);
  });
});

describe("splitSentences", () => {
  it("splits on sentence ends, keeping each citation with its sentence", () => {
    expect(
      splitSentences(
        "The team lost 43-41 [Source 1]. The relay decided it. [Source 2] Kent State won the meet."
      )
    ).toEqual([
      "The team lost 43-41 [Source 1].",
      "The relay decided it. [Source 2]",
      "Kent State won the meet.",
    ]);
  });

  it("drops headings and images and strips emphasis", () => {
    expect(
      splitSentences(
        "## The meet\n\nThe **relay** decided it [Source 1].\n![Pool](https://x/y.jpg)"
      )
    ).toEqual(["The relay decided it [Source 1]."]);
  });

  it("does not split after titles, months or initials", () => {
    expect(
      splitSentences("Dr. Smith spoke on Jan. 14 about John F. Kennedy [Source 1]. He left.")
    ).toEqual(["Dr. Smith spoke on Jan. 14 about John F. Kennedy [Source 1].", "He left."]);
  });
});

describe("sentenceCitations", () => {
  const ranked = ["1953-01-14-37", "1953-01-14-2", "1953-01-21-5"];

  it("maps pipeline markers to ranked ids, including grouped and shorthand forms", () => {
    expect(sentenceCitations("It was close [Source 1, Source 3].", ranked)).toEqual([
      "1953-01-14-37",
      "1953-01-21-5",
    ]);
    expect(sentenceCitations("It was close [Source 2, 3] [Source 2].", ranked)).toEqual([
      "1953-01-14-2",
      "1953-01-21-5",
    ]);
  });

  it("reads agent ids directly and ignores markers outside the ranked list", () => {
    expect(sentenceCitations("Close [1960-01-13-4, 1960-01-13-9].", [])).toEqual([
      "1960-01-13-4",
      "1960-01-13-9",
    ]);
    expect(sentenceCitations("Close [Source 7].", ranked)).toEqual([]);
  });
});

describe("score math", () => {
  it("scores nuggets 1 / 0.5 / 0, leaving echoes out and vital-only separately", () => {
    const nuggets = [
      { index: 0, phrases: ["a"], vital: true, echo: false },
      { index: 1, phrases: ["b"], vital: false, echo: false },
      { index: 2, phrases: ["c"], vital: true, echo: true },
    ];
    expect(nuggetScores(nuggets, ["partial", "supported", "unsupported"])).toEqual({
      all: 0.75,
      vital: 0.5,
    });
  });

  it("is null when nothing is left to score", () => {
    expect(
      nuggetScores([{ index: 0, phrases: ["c"], vital: true, echo: true }], ["supported"])
    ).toEqual({
      all: null,
      vital: null,
    });
    expect(supportScore(["no_claim"])).toBeNull();
  });

  it("averages sentence support full / partial / none as 1 / 0.5 / 0, skipping no-claim sentences", () => {
    expect(supportScore(["full", "partial", "none", "no_claim"])).toBeCloseTo(0.5, 12);
  });
});
