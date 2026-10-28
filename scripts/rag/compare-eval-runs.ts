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
 *   node --import tsx scripts/rag/compare-eval-runs.ts \
 *     --a <run-1.json> --b <run-2.json> --evidence tests/api/rag-dev-v2-questions.json \
 *     [--out <report.md>]
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { EvalRunFile, EvalRunRecord } from "./lib/eval-records";
import type { EvidenceCatalog, EvidenceQuestion } from "./score-eval";
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

function parseArgs(argv: string[]) {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!["--a", "--b", "--evidence", "--out"].includes(argv[i])) {
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
