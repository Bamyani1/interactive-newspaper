/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { contentHash, selectStratified } from "../../scripts/rag/build-retrieval-set.mjs";

const drafted = (id: string, question: string, usable = true) => ({
  row: { id, edition_date: id.slice(0, 10), headline: `Headline ${id}` },
  draft: { usable, question },
});

describe("selectStratified", () => {
  const sample = [
    drafted("1955-01-01-1", "Who won the 1955 homecoming game?"),
    drafted("1955-01-01-2", "garbled", false),
    drafted("1956-02-02-3", "   "),
    drafted("1957-03-03-4", "What did the 1957 senate decide about chapel?"),
    drafted("1958-04-04-5", "A third 1950s question?"),
    drafted("1961-05-05-6", "Why did students picket in 1961?"),
    drafted("1961-05-05-6", "The same article drawn twice?"),
    drafted("1962-06-06-7", "What did the 1962 trustees vote on?"),
  ];

  it("takes the first usable questions per decade, in sample order", () => {
    const { questions, counts } = selectStratified(sample, 2);
    expect(questions.map((q) => q.expectedSourceIdsAny[0])).toEqual([
      "1955-01-01-1",
      "1957-03-03-4",
      "1961-05-05-6",
      "1962-06-06-7",
    ]);
    expect(counts).toEqual({ "1950s": 2, "1960s": 2 });
  });

  it("never uses one source article twice", () => {
    const { questions, dropped } = selectStratified(sample, 5);
    const ids = questions.map((q) => q.expectedSourceIdsAny[0]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(dropped).toContain("1961-05-05-6: duplicate source");
  });

  it("records why an item was dropped", () => {
    const { dropped } = selectStratified(sample, 5);
    expect(dropped).toEqual(
      expect.arrayContaining(["1955-01-01-2: not usable", "1956-02-02-3: not usable"])
    );
  });

  it("writes each question with its decade and source", () => {
    const [first] = selectStratified(sample, 1).questions;
    expect(first).toEqual({
      id: "ret1-1955-01-01-1",
      question: "Who won the 1955 homecoming game?",
      mode: "text",
      decade: "1950s",
      expectedSourceIdsAny: ["1955-01-01-1"],
      source: "1955-01-01 — Headline 1955-01-01-1",
    });
  });
});

describe("contentHash", () => {
  const { questions } = selectStratified(
    [drafted("1955-01-01-1", "Q one?"), drafted("1961-05-05-6", "Q two?")],
    1
  );

  it("is a sha-256 hex digest that ignores question order", () => {
    expect(contentHash(questions)).toMatch(/^[0-9a-f]{64}$/);
    expect(contentHash([...questions].reverse())).toBe(contentHash(questions));
  });

  it("changes when any question changes", () => {
    const edited = questions.map((q, i) => (i === 0 ? { ...q, question: "Q one, edited?" } : q));
    expect(contentHash(edited)).not.toBe(contentHash(questions));
  });
});
