/** @vitest-environment node */
import { describe, it, expect, vi } from "vitest";
import {
  ndcgAt,
  pairedBootstrap,
  percentile,
  recallAt,
} from "../../scripts/rag/lib/retrieval-metrics";
import { gradeKey, gradePool } from "../../scripts/rag/lib/grade-cache";

describe("recallAt", () => {
  const grades = new Map([
    ["a", 2],
    ["b", 0],
    ["d", 1],
  ]);

  it("is the share of pooled relevant articles (grade >= 1) in the top k", () => {
    expect(recallAt(["a", "b", "c"], grades, 12)).toBe(0.5);
    expect(recallAt(["b", "a", "d"], grades, 2)).toBe(0.5);
  });

  it("is null when the pool holds nothing relevant", () => {
    expect(recallAt(["b"], new Map([["b", 0]]), 12)).toBeNull();
  });
});

describe("ndcgAt", () => {
  it("uses gains 2^grade - 1 against the pool's ideal order", () => {
    const grades = new Map([
      ["a", 2],
      ["b", 1],
    ]);
    // DCG = 1/log2(2) + 3/log2(3); IDCG = 3/log2(2) + 1/log2(3)
    const expected = (1 + 3 / Math.log2(3)) / (3 + 1 / Math.log2(3));
    expect(ndcgAt(["b", "a"], grades, 12)).toBeCloseTo(expected, 10);
    expect(ndcgAt(["a", "b"], grades, 12)).toBe(1);
  });

  it("treats an ungraded article as gain 0 and cuts at k", () => {
    const grades = new Map([["a", 2]]);
    expect(ndcgAt(["x", "a"], grades, 1)).toBe(0);
    expect(ndcgAt(["x", "a"], grades, 2)).toBeCloseTo(1 / Math.log2(3), 10);
  });

  it("is null when the pool holds nothing relevant", () => {
    expect(ndcgAt(["a"], new Map([["a", 0]]), 12)).toBeNull();
  });
});

describe("percentile", () => {
  it("uses the nearest rank", () => {
    const values = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(percentile(values, 95)).toBe(19);
    expect(percentile([5], 95)).toBe(5);
  });
});

describe("pairedBootstrap", () => {
  const diffs = [0.1, -0.05, 0.2, 0, 0.15, 0.05, -0.1, 0.3, 0.1, 0];

  it("is deterministic for a seed", () => {
    expect(pairedBootstrap(diffs, { seed: 7 })).toEqual(pairedBootstrap(diffs, { seed: 7 }));
  });

  it("brackets the mean difference", () => {
    const { mean, low, high } = pairedBootstrap(diffs, { seed: 7 });
    expect(mean).toBeCloseTo(0.075, 10);
    expect(low).toBeLessThan(mean);
    expect(high).toBeGreaterThan(mean);
  });

  it("collapses to the value when every difference is equal", () => {
    const result = pairedBootstrap([0.1, 0.1, 0.1], { seed: 1 });
    expect(result.n).toBe(3);
    for (const value of [result.mean, result.low, result.high]) expect(value).toBeCloseTo(0.1, 12);
  });
});

describe("gradePool", () => {
  it("grades only the pairs the cache does not hold", async () => {
    const cache = new Map([[gradeKey("Q?", "a", "v1"), 2]]);
    const grade = vi.fn().mockResolvedValue(1);

    const grades = await gradePool(
      [
        { question: "Q?", articleId: "a" },
        { question: "Q?", articleId: "b" },
      ],
      grade,
      cache,
      "v1"
    );

    expect(grade).toHaveBeenCalledTimes(1);
    expect(grade).toHaveBeenCalledWith({ question: "Q?", articleId: "b" });
    expect(grades.get(gradeKey("Q?", "a", "v1"))).toBe(2);
    expect(cache.get(gradeKey("Q?", "b", "v1"))).toBe(1);
  });

  it("keys grades by question, article and prompt version", () => {
    expect(gradeKey("Q?", "a", "v1")).not.toBe(gradeKey("Q?", "a", "v2"));
    expect(gradeKey("Q?", "a", "v1")).not.toBe(gradeKey("Q2?", "a", "v1"));
    expect(gradeKey("Q?", "a", "v1")).toBe(gradeKey("Q?", "a", "v1"));
  });
});
