/**
 * Owner label sheets: Markdown the owner reads and fills in, one "Label:"
 * line per item. Used to validate a judge (TPR/TNR against the owner's
 * labels) and to mark fact groups vital or optional.
 */

import { mulberry32 } from "./retrieval-metrics";

export interface SheetItem {
  id: string;
  body: string;
  choices: string[];
  /** Pre-filled label the owner may change. */
  prefill?: string;
}

const HEADING_RE = /^### (\S+)\s*$/;
const LABEL_RE = /^Label \(([^)]*)\):[ \t]*(\S*)/;

export function formatSheet(title: string, instructions: string, items: SheetItem[]): string {
  const blocks = items.map((item) =>
    [
      `### ${item.id}`,
      "",
      item.body,
      "",
      `Label (${item.choices.join(" / ")}): ${item.prefill ?? ""}`.trimEnd(),
    ].join("\n")
  );
  return `# ${title}\n\n${instructions}\n\n${blocks.join("\n\n---\n\n")}\n`;
}

/** Labels written on a sheet, keyed by item id; blank labels are skipped. */
export function parseSheet(markdown: string): Map<string, string> {
  const labels = new Map<string, string>();
  let current: string | null = null;
  for (const line of markdown.split("\n")) {
    const heading = line.match(HEADING_RE);
    if (heading) {
      current = heading[1];
      continue;
    }
    const label = line.match(LABEL_RE);
    if (!label || current === null) continue;
    const value = label[2].toLowerCase();
    if (value) {
      const choices = label[1].split("/").map((c) => c.trim());
      if (!choices.includes(value)) {
        throw new Error(`${current}: label "${value}" is not one of ${choices.join(", ")}`);
      }
      labels.set(current, value);
    }
    current = null;
  }
  return labels;
}

const POSITIVE = new Set(["full", "supported"]);
const NOT_A_CLAIM = "no_claim";
const GATE = 0.9;

/**
 * Judge agreement with the owner on items both labeled. Positive means fully
 * supported (full / supported); partial and none count as negative; items
 * either side calls no_claim count toward exact agreement only.
 */
export function validateJudge(owner: Map<string, string>, judge: Map<string, string>) {
  let n = 0;
  let exact = 0;
  let positives = 0;
  let negatives = 0;
  let truePositives = 0;
  let trueNegatives = 0;
  for (const [id, ownerLabel] of owner) {
    const judgeLabel = judge.get(id);
    if (judgeLabel === undefined) continue;
    n += 1;
    if (judgeLabel === ownerLabel) exact += 1;
    if (ownerLabel === NOT_A_CLAIM || judgeLabel === NOT_A_CLAIM) continue;
    if (POSITIVE.has(ownerLabel)) {
      positives += 1;
      if (POSITIVE.has(judgeLabel)) truePositives += 1;
    } else {
      negatives += 1;
      if (!POSITIVE.has(judgeLabel)) trueNegatives += 1;
    }
  }
  const tpr = positives === 0 ? null : truePositives / positives;
  const tnr = negatives === 0 ? null : trueNegatives / negatives;
  return {
    n,
    exact: n === 0 ? null : exact / n,
    positives,
    negatives,
    tpr,
    tnr,
    passes: tpr !== null && tnr !== null && tpr > GATE && tnr > GATE,
  };
}

/** Writes owner vital/optional marks (sheet ids "V:<questionId>:<group>") onto the catalog. */
export function applyVital<
  Q extends { id: string; expectedFactsAny?: string[][]; expectedFactsVital?: boolean[] },
>(catalog: { questions: Q[] }, labels: Map<string, string>): { questions: Q[] } {
  return {
    ...catalog,
    questions: catalog.questions.map((question) => {
      const groups = question.expectedFactsAny ?? [];
      const marks = groups.map((_, index) => labels.get(`V:${question.id}:${index}`));
      if (marks.every((mark) => mark === undefined)) return question;
      return { ...question, expectedFactsVital: marks.map((mark) => mark !== "optional") };
    }),
  };
}

/** n items in a seeded random order that does not depend on the input order. */
export function sampleItems<T>(items: T[], n: number, seed: number, key: (item: T) => string): T[] {
  const random = mulberry32(seed);
  const shuffled = [...items].sort((a, b) => key(a).localeCompare(key(b)));
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, n);
}
