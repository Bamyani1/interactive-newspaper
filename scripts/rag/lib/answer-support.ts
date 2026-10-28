/**
 * Answer scoring by support rather than substrings: fact groups become
 * nuggets (vital or optional, echoes of the question flagged), answers split
 * into sentences, and each sentence maps to the articles it cites.
 */

export type NuggetLabel = "supported" | "partial" | "unsupported";
export type SupportLabel = "full" | "partial" | "none" | "no_claim";

export const NUGGET_LABELS: NuggetLabel[] = ["supported", "partial", "unsupported"];
export const SUPPORT_LABELS: SupportLabel[] = ["full", "partial", "none", "no_claim"];

export interface Nugget {
  index: number;
  phrases: string[];
  vital: boolean;
  /** The question's own words satisfy it, so an answer earns it for free. */
  echo: boolean;
}

export function nuggetsFor(question: {
  question?: string;
  expectedFactsAny?: string[][];
  expectedFactsVital?: boolean[];
}): Nugget[] {
  const asked = (question.question ?? "").toLowerCase();
  return (question.expectedFactsAny ?? []).map((phrases, index) => ({
    index,
    phrases,
    vital: question.expectedFactsVital?.[index] ?? true,
    echo: phrases.some((phrase) => asked.includes(phrase.toLowerCase())),
  }));
}

// Same marker forms the route grounds (src/lib/answer-grounding.ts).
const PIPELINE_CITATION_RE = /\[Source (\d+(?:\s*,\s*(?:Source\s*)?\d+)*)\]/gi;
const AGENT_CITATION_RE = /\[(\d{4}-\d{2}-\d{2}-\d+(?:\s*,\s*\d{4}-\d{2}-\d{2}-\d+)*)\]/g;
const ANY_CITATION_RE =
  /^(?:\s*\[(?:Source \d+(?:\s*,\s*(?:Source\s*)?\d+)*|\d{4}-\d{2}-\d{2}-\d+(?:\s*,\s*\d{4}-\d{2}-\d{2}-\d+)*)\])+/i;
const NO_SPLIT_AFTER =
  /(?:\b(?:Mr|Mrs|Ms|Dr|Prof|St|Jr|Sr|Rev|Gen|Col|Lt|Sgt|Capt|Gov|Sen|Rep|Pres|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|No|vs)|\b[A-Z])\.$/;

/** Claim-bearing sentences of an answer: no headings, images or emphasis; citations stay attached. */
export function splitSentences(answer: string): string[] {
  const sentences: string[] = [];
  for (const rawLine of answer.replace(/!\[[^\]\r\n]*\]\([^)\r\n]*\)/g, "").split(/\n+/)) {
    const line = rawLine.replace(/\*\*|__/g, "").trim();
    if (!line || line.startsWith("#")) continue;
    const pieces = line.split(/(?<=[.!?]["”’)]?)\s+/);
    const merged: string[] = [];
    for (const piece of pieces) {
      const previous = merged[merged.length - 1];
      if (previous !== undefined && NO_SPLIT_AFTER.test(previous)) {
        merged[merged.length - 1] = `${previous} ${piece}`;
        continue;
      }
      // A marker placed after the period belongs to the sentence before it.
      const leading = piece.match(ANY_CITATION_RE)?.[0];
      if (previous !== undefined && leading) {
        merged[merged.length - 1] = `${previous} ${leading.trim()}`;
        const rest = piece.slice(leading.length).trim();
        if (rest) merged.push(rest);
        continue;
      }
      merged.push(piece);
    }
    sentences.push(...merged.filter((s) => s.length > 0));
  }
  return sentences;
}

/** Article ids a sentence cites, in order, deduplicated. */
export function sentenceCitations(sentence: string, rankedSourceIds: string[]): string[] {
  const ids: string[] = [];
  for (const match of sentence.matchAll(PIPELINE_CITATION_RE)) {
    for (const raw of match[1].split(/\s*,\s*/)) {
      const id = rankedSourceIds[Number.parseInt(raw.replace(/^Source\s*/i, ""), 10) - 1];
      if (id) ids.push(id);
    }
  }
  for (const match of sentence.matchAll(AGENT_CITATION_RE)) ids.push(...match[1].split(/\s*,\s*/));
  return [...new Set(ids)];
}

/** Sentence text with citation markers removed, for the judge. */
export function stripCitations(sentence: string): string {
  return sentence
    .replace(PIPELINE_CITATION_RE, "")
    .replace(AGENT_CITATION_RE, "")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

const NUGGET_VALUE: Record<NuggetLabel, number> = { supported: 1, partial: 0.5, unsupported: 0 };
const SUPPORT_VALUE: Record<Exclude<SupportLabel, "no_claim">, number> = {
  full: 1,
  partial: 0.5,
  none: 0,
};

const meanOrNull = (values: number[]) =>
  values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0) / values.length;

/** Mean nugget credit over non-echo nuggets, all and vital-only. */
export function nuggetScores(
  nuggets: Nugget[],
  labels: NuggetLabel[]
): { all: number | null; vital: number | null } {
  const scored = nuggets.filter((n) => !n.echo);
  return {
    all: meanOrNull(scored.map((n) => NUGGET_VALUE[labels[n.index]])),
    vital: meanOrNull(scored.filter((n) => n.vital).map((n) => NUGGET_VALUE[labels[n.index]])),
  };
}

/** Mean sentence support, skipping sentences that make no claim. */
export function supportScore(labels: SupportLabel[]): number | null {
  return meanOrNull(
    labels
      .filter((l): l is Exclude<SupportLabel, "no_claim"> => l !== "no_claim")
      .map((l) => SUPPORT_VALUE[l])
  );
}
