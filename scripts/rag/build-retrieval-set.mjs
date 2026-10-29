#!/usr/bin/env node
/**
 * Build the rag-retrieval-v1 question set for retrieval-only evals.
 *
 * Samples articles from the serving index build, stratified by decade (every
 * decade in the corpus gets the same share), and has Claude Haiku write one
 * question per article that the article answers. Each question is tied to its
 * source article; scripts/rag/run-retrieval-eval.ts pools and grades the
 * other articles a variant returns. The file carries a content hash so a run
 * records exactly which set it used.
 *
 *   node --env-file=.env.local --import tsx scripts/rag/build-retrieval-set.mjs \
 *     --out tests/api/rag-retrieval-v1-questions.json [--per-decade 50]
 *
 * Reads the database and writes only the output file. Costs well under $1.
 */

import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { mapLimit } from "./build-dev-catalog.mjs";

const MODEL = "claude-haiku-5-5";
const EFFORT = "xhigh";
const PRICE = { input: 0.1, output: 0.5 }; // USD per million tokens
const SEED = "rag-retrieval-v1";
const OVERSAMPLE = 1.3;
const MAX_BODY_CHARS = 12_000;
const CONCURRENCY = 4;

const SYSTEM_PROMPT = `You write evaluation questions for "Ask the Archive", a question-answering tool over The Transcript, Ohio Wesleyan University's student newspaper.

You get one archived article. Write the question a curious reader (an alum, a student, a historian) would type that THIS article answers well.
- Natural language, under 25 words. Paraphrase; never copy the headline or a distinctive sentence.
- Specific enough that this article is a strong answer. About half the time, mention the era or year the way a reader who remembers it would.
- Never say "this article" or refer to page layout.
- Set usable to false when the text is too garbled, fragmentary or trivial for a good question.`;

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["usable", "question"],
  properties: {
    usable: { type: "boolean" },
    question: { type: "string" },
  },
};

/** @param {string} editionDate */
const decadeOf = (editionDate) => `${editionDate.slice(0, 3)}0s`;

/**
 * @typedef {{ id: string, edition_date: string, headline: string }} SampledRow
 * @typedef {{ usable: boolean, question: string }} Draft
 * @typedef {{ id: string, question: string, mode: "text", decade: string,
 *   expectedSourceIdsAny: string[], source: string }} RetrievalQuestion
 */

/**
 * Keep the first `perDecade` usable drafts of each decade, in sample order,
 * never using one source article twice.
 * @param {{ row: SampledRow, draft: Draft }[]} drafted
 * @param {number} perDecade
 * @returns {{ questions: RetrievalQuestion[], dropped: string[], counts: Record<string, number> }}
 */
export function selectStratified(drafted, perDecade) {
  /** @type {RetrievalQuestion[]} */
  const questions = [];
  /** @type {string[]} */
  const dropped = [];
  /** @type {Record<string, number>} */
  const counts = {};
  const used = new Set();
  for (const { row, draft } of drafted) {
    const decade = decadeOf(row.edition_date);
    const question = draft.question?.trim() ?? "";
    if (used.has(row.id)) {
      dropped.push(`${row.id}: duplicate source`);
      continue;
    }
    if (!draft.usable || !question) {
      dropped.push(`${row.id}: not usable`);
      continue;
    }
    if ((counts[decade] ?? 0) >= perDecade) continue;
    used.add(row.id);
    counts[decade] = (counts[decade] ?? 0) + 1;
    questions.push({
      id: `ret1-${row.id}`,
      question,
      mode: "text",
      decade,
      expectedSourceIdsAny: [row.id],
      source: `${row.edition_date} — ${row.headline}`,
    });
  }
  return { questions, dropped, counts };
}

/**
 * SHA-256 of the questions, independent of their order.
 * @param {RetrievalQuestion[]} questions
 */
export function contentHash(questions) {
  const sorted = [...questions].sort((a, b) => a.id.localeCompare(b.id));
  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
}

/** @param {string[]} argv */
function parseArgs(argv) {
  const args = { out: /** @type {string | null} */ (null), perDecade: 50 };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = () => argv[++i];
    if (flag === "--out") args.out = next();
    else if (flag === "--per-decade") args.perDecade = Number(next());
    else throw new Error(`Unknown argument: ${flag}`);
  }
  if (!args.out) throw new Error("--out <path> is required");
  return { out: args.out, perDecade: args.perDecade };
}

const SERVED_ARTICLE = `EXISTS (SELECT 1 FROM article_chunks c
                               JOIN rag_serving_pointer p ON p.index_build_id = c.index_build_id
                               WHERE c.article_id = a.id)`;

/** @param {{ query: (q: { text: string, params?: unknown[] }) => Promise<any[]> }} executor */
async function sampleArticles(executor, perDecade) {
  const decades = (
    await executor.query({
      text: `SELECT DISTINCT substr(a.edition_date, 1, 3) AS prefix FROM articles a
             WHERE ${SERVED_ARTICLE} ORDER BY 1`,
    })
  ).map((row) => row.prefix);
  const rows = [];
  for (const prefix of decades) {
    rows.push(
      ...(await executor.query({
        text: `SELECT a.id, a.edition_date, a.headline, a.category, a.body_plain
               FROM articles a
               WHERE length(a.body_plain) >= 800
                 AND substr(a.edition_date, 1, 3) = $1
                 AND ${SERVED_ARTICLE}
               ORDER BY md5(a.id || $2)
               LIMIT $3`,
        params: [prefix, SEED, Math.ceil(perDecade * OVERSAMPLE)],
      }))
    );
  }
  return { decades: decades.map((prefix) => `${prefix}0s`), rows };
}

function articlePrompt(row) {
  return [
    `Edition: ${row.edition_date}`,
    `Section: ${row.category}`,
    `Headline: ${row.headline}`,
    "",
    String(row.body_plain).slice(0, MAX_BODY_CHARS),
  ].join("\n");
}

async function draftQuestion(client, prompt, usage) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16_000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
    thinking: { type: "adaptive" },
    output_config: { effort: EFFORT, format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
  });
  usage.input += response.usage.input_tokens;
  usage.output += response.usage.output_tokens;
  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
  return JSON.parse(text);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is required.");

  const executorModule = await import("../db/lib/neon-executor.ts");
  const { createNeonExecutor } = executorModule.default ?? executorModule;
  const executor = createNeonExecutor(process.env.DATABASE_URL);
  const client = new Anthropic({ maxRetries: 4 });
  const usage = { input: 0, output: 0 };

  const { decades, rows } = await sampleArticles(executor, args.perDecade);
  console.error(`Sampled ${rows.length} articles across ${decades.join(", ")}.`);

  const drafted = await mapLimit(rows, CONCURRENCY, async (row) => ({
    row,
    draft: await draftQuestion(client, articlePrompt(row), usage),
  }));
  const { questions, dropped, counts } = selectStratified(drafted, args.perDecade);

  const cost = (usage.input * PRICE.input + usage.output * PRICE.output) / 1e6;
  console.error(`Drafted for $${cost.toFixed(3)}; per decade: ${JSON.stringify(counts)}.`);
  for (const reason of dropped) console.error(`  dropped ${reason}`);
  const short = decades.filter((decade) => (counts[decade] ?? 0) < args.perDecade);
  if (short.length > 0) {
    throw new Error(`Too few usable questions in ${short.join(", ")}; lower --per-decade.`);
  }

  const set = {
    schemaVersion: 1,
    datasetId: "rag-retrieval-v1",
    split: "development",
    contentHash: contentHash(questions),
    provenance: `Written by ${MODEL} (effort ${EFFORT}) from a seeded sample of served articles, ${args.perDecade} per decade (scripts/rag/build-retrieval-set.mjs). Synthetic: for retrieval decisions only.`,
    questions,
  };
  writeFileSync(args.out, `${JSON.stringify(set, null, 2)}\n`);
  console.error(`Wrote ${questions.length} questions to ${args.out} (${set.contentHash.slice(0, 12)}).`);
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entryPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
