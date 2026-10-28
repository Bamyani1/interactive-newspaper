/**
 * Owner label sheets for the answer judges.
 *
 *   # Judge TPR/TNR against the owner's labels (the sheet judge-eval.ts --sheet wrote):
 *   node --import tsx scripts/rag/label-sheets.ts --validate <sheet.md> --judged <run.judged-haiku.json>
 *
 *   # Mark fact groups vital or optional:
 *   node --import tsx scripts/rag/label-sheets.ts --vital-sheet <out.md> [--evidence <questions.json>]
 *   node --import tsx scripts/rag/label-sheets.ts --apply-vital <sheet.md> [--evidence <questions.json>]
 *
 * A judge's numbers decide nothing until --validate reports TPR and TNR
 * above 90%. --apply-vital rewrites the evidence file's expectedFactsVital.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nuggetsFor } from "./lib/answer-support";
import {
  applyVital,
  formatSheet,
  parseSheet,
  validateJudge,
  type SheetItem,
} from "./lib/label-sheet";
import type { JudgedRun } from "./judge-eval";
import type { EvidenceCatalog, EvidenceQuestion } from "./score-eval";

/** The judge's labels under the ids the owner sheet uses. */
export function judgeLabelsById(judged: JudgedRun): Map<string, string> {
  const labels = new Map<string, string>();
  for (const q of judged.questions) {
    q.sentences.forEach((s, i) => labels.set(`S:${q.questionId}:${i}`, s.label));
    for (const n of q.nuggets) {
      if (n.label) labels.set(`N:${q.questionId}:${n.index}`, n.label);
    }
  }
  return labels;
}

export function vitalSheetItems(catalog: { questions: EvidenceQuestion[] }): SheetItem[] {
  return catalog.questions.flatMap((question) =>
    nuggetsFor(question)
      .filter((n) => !n.echo)
      .map((n) => ({
        id: `V:${question.id}:${n.index}`,
        body: [
          `**Question:** ${question.question ?? ""}`,
          `**Fact:** ${n.phrases.map((p) => `"${p}"`).join(" / ")}`,
        ].join("\n"),
        choices: ["vital", "optional"],
        prefill: question.expectedFactsVital?.[n.index] === false ? "optional" : "vital",
      }))
  );
}

function main() {
  const argv = process.argv.slice(2);
  const flag = (name: string) => {
    const index = argv.indexOf(name);
    return index === -1 ? null : (argv[index + 1] ?? null);
  };
  const evidencePath = flag("--evidence") ?? "tests/api/rag-dev-v2-questions.json";
  const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);

  const validate = flag("--validate");
  if (validate) {
    const judgedPath = flag("--judged");
    if (!judgedPath) throw new Error("--validate needs --judged <file>");
    const judged = JSON.parse(readFileSync(judgedPath, "utf8")) as JudgedRun;
    const owner = parseSheet(readFileSync(validate, "utf8"));
    const judge = judgeLabelsById(judged);
    const kinds = { sentences: "S:", facts: "N:" };
    for (const [kind, prefix] of Object.entries(kinds)) {
      const subset = new Map([...owner].filter(([id]) => id.startsWith(prefix)));
      const r = validateJudge(subset, judge);
      console.log(
        `${judged.judge} ${kind}: n=${r.n}, exact ${pct(r.exact)}, TPR ${pct(r.tpr)} (${r.positives} positive), TNR ${pct(r.tnr)} (${r.negatives} negative) → ${r.passes ? "PASS" : "FAIL"} (both must be > 90%)`
      );
    }
    return;
  }

  const vitalSheet = flag("--vital-sheet");
  if (vitalSheet) {
    const catalog = JSON.parse(readFileSync(evidencePath, "utf8")) as EvidenceCatalog;
    const items = vitalSheetItems(catalog);
    writeFileSync(
      vitalSheet,
      formatSheet(
        "Vital facts",
        "Each fact is pre-filled **vital**. Change it to **optional** when a good answer could leave it out. Then run `node --import tsx scripts/rag/label-sheets.ts --apply-vital <this sheet>`.",
        items
      )
    );
    console.log(`${items.length} fact groups → ${vitalSheet}`);
    return;
  }

  const applyPath = flag("--apply-vital");
  if (applyPath) {
    const catalog = JSON.parse(readFileSync(evidencePath, "utf8")) as EvidenceCatalog;
    const labels = parseSheet(readFileSync(applyPath, "utf8"));
    const marked = applyVital(catalog, labels);
    writeFileSync(evidencePath, `${JSON.stringify(marked, null, 2)}\n`);
    const optional = [...labels.values()].filter((v) => v === "optional").length;
    console.log(`${labels.size} marks applied (${optional} optional) → ${evidencePath}`);
    return;
  }

  throw new Error("Pass --validate, --vital-sheet or --apply-vital.");
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
