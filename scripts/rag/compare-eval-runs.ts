/**
 * Compare two answer-path eval runs question by question.
 *
 * Run twice with the same configuration (an A/A test), this measures the
 * pipeline's own noise: how many questions flip between pass and fail with
 * nothing changed, an exact McNemar test on those flips, a paired bootstrap
 * interval on mean fact recall, and the smallest effect a run of this size
 * could detect. Run on an A/B pair, the same report says whether a change
 * beat that noise.
 *
 * A question passes when every fact group appears in the answer, or, for a
 * question without facts, when it cites an expected source.
 *
 * With judged files (scripts/rag/judge-eval.ts, one per judge and run), it
 * also reports each judge's paired difference on sentence support and
 * nugget scores, and whether the judges agree on the direction; a change
 * counts only when they do.
 *
 *   node --import tsx scripts/rag/compare-eval-runs.ts \
 *     --a <run-1.json> --b <run-2.json> --evidence tests/api/rag-dev-v2-questions.json \
 *     [--judged-a <a.judged-haiku.json,a.judged-sonnet.json> --judged-b <...>] [--out <report.md>]
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { EvalRunFile, EvalRunRecord } from "./lib/eval-records";
import type { EvidenceCatalog, EvidenceQuestion } from "./score-eval";
import type { JudgedRun } from "./judge-eval";
import { pairedBootstrap } from "./lib/retrieval-metrics";

// z for a two-sided 5% test plus z for 80% power.
const Z_ALPHA_PLUS_POWER = 1.959964 + 0.841621;

interface Outcome {
  pass: 0 | 1;
  factRecall: number | null;
}

function outcomeFor(record: EvalRunRecord, question: EvidenceQuestion): Outcome {
  const answer = record.answer.text.toLowerCase();
  const facts = question.expectedFactsAny ?? [];
  const factRecall = facts.length
    ? facts.filter((group) => group.some((p) => answer.includes(p.toLowerCase()))).length /
      facts.length
    : null;
  const expected = new Set(question.expectedSourceIdsAny ?? []);
  const cited = record.answer.citations.some((id) => expected.has(id));
  const pass = factRecall !== null ? factRecall === 1 : cited;
  return { pass: pass ? 1 : 0, factRecall };
}

/** Two-sided exact binomial p-value on the discordant pairs. */
export function mcnemarExact(aOnly: number, bOnly: number): number {
  const n = aOnly + bOnly;
  if (n === 0) return 1;
  const k = Math.min(aOnly, bOnly);
  let tail = 0;
  let coefficient = 1; // C(n, 0)
  for (let i = 0; i <= k; i += 1) {
    if (i > 0) coefficient = (coefficient * (n - i + 1)) / i;
    tail += coefficient;
  }
  return Math.min(1, (2 * tail) / 2 ** n);
}

/** Smallest mean paired difference detectable at 5% two-sided with 80% power. */
export function minimumDetectableEffect(diffs: number[]): number {
  const n = diffs.length;
  const mean = diffs.reduce((s, d) => s + d, 0) / n;
  const variance = diffs.reduce((s, d) => s + (d - mean) ** 2, 0) / (n - 1);
  return (Z_ALPHA_PLUS_POWER * Math.sqrt(variance)) / Math.sqrt(n);
}

export function compareRuns(
  a: EvalRunFile,
  b: EvalRunFile,
  evidence: EvidenceCatalog,
  { seed }: { seed: number }
) {
  const questions = new Map(evidence.questions.map((q) => [q.id, q]));
  const bById = new Map(b.records.map((r) => [r.questionId, r]));
  const pairs: { id: string; a: Outcome; b: Outcome }[] = [];
  for (const recordA of a.records) {
    const question = questions.get(recordA.questionId);
    const recordB = bById.get(recordA.questionId);
    if (!question || !recordB) continue;
    pairs.push({
      id: recordA.questionId,
      a: outcomeFor(recordA, question),
      b: outcomeFor(recordB, question),
    });
  }
  const aOnly = pairs.filter((p) => p.a.pass === 1 && p.b.pass === 0);
  const bOnly = pairs.filter((p) => p.a.pass === 0 && p.b.pass === 1);
  const withFacts = pairs.filter((p) => p.a.factRecall !== null && p.b.factRecall !== null);
  const factDiffs = withFacts.map((p) => (p.b.factRecall as number) - (p.a.factRecall as number));
  const passDiffs = pairs.map((p) => p.b.pass - p.a.pass);
  const meanOf = (values: number[]) => values.reduce((s, v) => s + v, 0) / values.length;
  return {
    n: pairs.length,
    passRate: { a: meanOf(pairs.map((p) => p.a.pass)), b: meanOf(pairs.map((p) => p.b.pass)) },
    disagreement: (aOnly.length + bOnly.length) / pairs.length,
    mcnemar: {
      aOnly: aOnly.length,
      bOnly: bOnly.length,
      p: mcnemarExact(aOnly.length, bOnly.length),
    },
    flipped: [...aOnly, ...bOnly].map((p) => p.id),
    factRecall: {
      a: meanOf(withFacts.map((p) => p.a.factRecall as number)),
      b: meanOf(withFacts.map((p) => p.b.factRecall as number)),
      ci: pairedBootstrap(factDiffs, { seed }),
      mde: factDiffs.length > 1 ? minimumDetectableEffect(factDiffs) : null,
    },
    passMde: passDiffs.length > 1 ? minimumDetectableEffect(passDiffs) : null,
  };
}

const JUDGED_METRICS = ["supportScore", "nuggetScore", "vitalNuggetScore"] as const;
type JudgedMetric = (typeof JUDGED_METRICS)[number];

/**
 * Per judge, the paired B − A difference on each judged score; the judges
 * agree when every judge's mean difference has the same nonzero sign.
 */
export function judgeDirections(a: JudgedRun[], b: JudgedRun[], { seed }: { seed: number }) {
  const bByJudge = new Map(b.map((run) => [run.judge, run]));
  for (const run of a) {
    if (!bByJudge.has(run.judge)) throw new Error(`Run B has no ${run.judge} judgments.`);
  }
  const result = {} as Record<
    JudgedMetric,
    { byJudge: Record<string, ReturnType<typeof pairedBootstrap>>; agree: boolean }
  >;
  for (const metric of JUDGED_METRICS) {
    const byJudge: Record<string, ReturnType<typeof pairedBootstrap>> = {};
    for (const runA of a) {
      const scoresB = new Map(
        (bByJudge.get(runA.judge) as JudgedRun).questions.map((q) => [q.questionId, q[metric]])
      );
      const diffs = runA.questions.flatMap((q) => {
        const scoreA = q[metric];
        const scoreB = scoresB.get(q.questionId);
        return scoreA === null || scoreB === null || scoreB === undefined ? [] : [scoreB - scoreA];
      });
      byJudge[runA.judge] = pairedBootstrap(diffs, { seed });
    }
    const signs = Object.values(byJudge).map((ci) => (ci.n === 0 ? 0 : Math.sign(ci.mean)));
    result[metric] = {
      byJudge,
      agree: signs.length > 0 && signs.every((sign) => sign !== 0 && sign === signs[0]),
    };
  }
  return result;
}

function parseArgs(argv: string[]) {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!["--a", "--b", "--evidence", "--out", "--judged-a", "--judged-b"].includes(argv[i])) {
      throw new Error(`Unknown argument: ${argv[i]}`);
    }
    args[argv[i].slice(2)] = argv[i + 1];
  }
  if (!args.a || !args.b || !args.evidence) throw new Error("--a, --b and --evidence are required");
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const read = <T>(file: string) => JSON.parse(readFileSync(file, "utf8")) as T;
  const a = read<EvalRunFile>(args.a);
  const b = read<EvalRunFile>(args.b);
  const result = compareRuns(a, b, read<EvidenceCatalog>(args.evidence), { seed: 20261028 });
  if (Boolean(args["judged-a"]) !== Boolean(args["judged-b"])) {
    throw new Error("--judged-a and --judged-b go together");
  }
  const readJudged = (list: string) => list.split(",").map((file) => read<JudgedRun>(file.trim()));
  const directions = args["judged-a"]
    ? judgeDirections(readJudged(args["judged-a"]), readJudged(args["judged-b"]), {
        seed: 20261028,
      })
    : null;
  const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);
  const lines = [
    `# ${a.runId} vs ${b.runId}`,
    "",
    `- Questions paired: ${result.n}`,
    `- Pass rate: ${pct(result.passRate.a)} vs ${pct(result.passRate.b)}`,
    `- Questions that flipped: ${result.mcnemar.aOnly + result.mcnemar.bOnly} (${pct(result.disagreement)}): ${result.mcnemar.aOnly} passed only in A, ${result.mcnemar.bOnly} only in B; McNemar exact p = ${result.mcnemar.p.toFixed(3)}`,
    `- Fact recall: ${pct(result.factRecall.a)} vs ${pct(result.factRecall.b)}; B − A ${pct(result.factRecall.ci.mean)}, 95% CI [${pct(result.factRecall.ci.low)}, ${pct(result.factRecall.ci.high)}] over ${result.factRecall.ci.n} questions`,
    `- Minimum detectable effect (5%, 80% power): fact recall ${pct(result.factRecall.mde)}, pass rate ${pct(result.passMde)}`,
    "",
    `Flipped: ${result.flipped.join(", ") || "none"}`,
  ];
  if (directions) {
    lines.push("", "## Judged scores (B − A, paired 95% CI)", "");
    for (const metric of JUDGED_METRICS) {
      const { byJudge, agree } = directions[metric];
      const perJudge = Object.entries(byJudge)
        .map(([judge, ci]) =>
          ci.n === 0
            ? `${judge} —`
            : `${judge} ${pct(ci.mean)} [${pct(ci.low)}, ${pct(ci.high)}] (n=${ci.n})`
        )
        .join("; ");
      lines.push(`- ${metric}: ${perJudge}; judges agree on direction: ${agree ? "yes" : "no"}`);
    }
  }
  const markdown = `${lines.join("\n")}\n`;
  if (args.out) writeFileSync(args.out, markdown);
  console.log(markdown);
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entryPath === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
