/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { scoreRuns, type QuestionRun } from "../../scripts/rag/run-retrieval-eval";
import { gradeKey } from "../../scripts/rag/lib/grade-cache";

const run = (variants: QuestionRun["variants"]): QuestionRun => ({
  id: "q1",
  question: "Q?",
  decade: "1960s",
  mode: "text",
  reformulateMs: 0,
  retrieveMs: 0,
  candidates: 3,
  variants,
});
const ranked = (ids: string[]) => ({ ids, scores: ids.map(() => 5), ms: 1, degraded: false });

describe("scoreRuns", () => {
  const grades = new Map([
    [gradeKey("Q?", "a", "grade-v1"), 2],
    [gradeKey("Q?", "b", "grade-v1"), 0],
    [gradeKey("Q?", "c", "grade-v1"), 1],
  ]);

  it("judges every variant against the pool of all variants' lists", () => {
    const scored = scoreRuns([run({ claude: ranked(["a", "b"]), voyage: ranked(["c"]) })], grades, [
      "claude",
      "voyage",
    ]);
    // The pool's relevant articles are a and c, whichever variant found them.
    expect(scored.claude.recall).toEqual([0.5]);
    expect(scored.voyage.recall).toEqual([0.5]);
    expect(scored.claude.ndcg[0]).toBeCloseTo(3 / (3 + 1 / Math.log2(3)), 10);
  });

  it("scores a failed variant as missing, not zero", () => {
    const scored = scoreRuns(
      [run({ claude: ranked(["a"]), voyage: { ...ranked([]), error: "timeout" } })],
      grades,
      ["claude", "voyage"]
    );
    expect(scored.voyage.recall).toEqual([null]);
    expect(scored.claude.recall).toEqual([1]);
  });
});
