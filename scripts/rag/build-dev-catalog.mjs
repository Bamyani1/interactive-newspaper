#!/usr/bin/env node
/**
 * Build the rag-development-v2 question catalog from the archive itself.
 *
 * Samples articles (stratified by decade) and captioned photos from the
 * active index build, and has Claude write one question per item that the
 * item answers, plus short facts quoted from it. A fact that does not appear
 * verbatim in the source is dropped, and so is a text question left with
 * none. The output uses the tests/api/rag-golden-questions.json schema, so
 * scripts/rag/run-eval.ts and score-eval.ts read it unchanged.
 *
 *   node --env-file=.env.local --import tsx scripts/rag/build-dev-catalog.mjs \
 *     --out tests/api/rag-dev-v2-questions.json --review review.md \
 *     [--per-decade 14] [--photos 16]
 *
 * Reads the database and writes only the output files. Costs about $1.
 */

import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-sonnet-5-5";
const PRICE = { input: 2, output: 10 }; // USD per million tokens
const DECADES = ["195", "196", "197", "198", "199", "200"];
const SEED = "rag-dev-v2";
const MAX_BODY_CHARS = 12_000;
const CONCURRENCY = 4;

const SYSTEM_PROMPT = `You write evaluation questions for "Ask the Archive", a question-answering tool over The Transcript, Ohio Wesleyan University's student newspaper (1950-2006).

You get one archived item. Write the question a curious reader (an alum, a student, a historian) would type that THIS item answers well.
- Natural language, under 25 words. Paraphrase; never copy the headline.
- Specific enough that this item is a strong answer. About half the time, mention the era or year the way a reader who remembers it would.
- Never say "this article", "this photo" or refer to page layout.
- facts: 1 to 3 groups. Each group lists 1 to 3 alternative short phrases (1 to 5 words: names, numbers, places, distinctive terms) copied EXACTLY from the item's text. A correct answer would contain at least one phrase from every group.
- Set usable to false when the text is too garbled, fragmentary or trivial for a good question.`;

const PHOTO_INSTRUCTIONS = `This item is a photograph. Write the request a reader would make to find it, such as "Show me photos of ...". Describe what is pictured in your own words; do not quote the caption. Facts come from the caption or the article.`;

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["usable", "question", "facts"],
  properties: {
    usable: { type: "boolean" },
    question: { type: "string" },
    facts: { type: "array", items: { type: "array", items: { type: "string" } } },
  },
};

function parseArgs(argv) {
  const args = { out: null, review: null, perDecade: 14, photos: 16 };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = () => argv[++i];
    if (flag === "--out") args.out = next();
    else if (flag === "--review") args.review = next();
    else if (flag === "--per-decade") args.perDecade = Number(next());
    else if (flag === "--photos") args.photos = Number(next());
    else throw new Error(`Unknown argument: ${flag}`);
  }
  if (!args.out) throw new Error("--out <path> is required");
  return args;
}

const normalize = (text) => text.toLowerCase().replace(/\s+/g, " ");

/** Keep only fact phrases that appear in the source text. */
export function verifiedFactGroups(groups, sourceText) {
  const haystack = normalize(sourceText);
  return groups
    .map((group) =>
      [...new Set(group.map((p) => p.trim()))].filter(
        (phrase) => phrase.length > 1 && haystack.includes(normalize(phrase))
      )
    )
    .filter((group) => group.length > 0);
}

async function sampleArticles(executor, perDecade) {
  const rows = [];
  for (const decade of DECADES) {
    rows.push(
      ...(await executor.query({
        text: `SELECT a.id, a.edition_date, a.headline, a.category, a.byline, a.body_plain
               FROM articles a
               WHERE length(a.body_plain) >= 800
                 AND substr(a.edition_date, 1, 3) = $1
                 AND EXISTS (SELECT 1 FROM article_chunks c
                             JOIN rag_index_builds b ON b.id = c.index_build_id
                             WHERE b.status = 'active' AND c.article_id = a.id)
               ORDER BY md5(a.id || $2)
               LIMIT $3`,
        params: [decade, SEED, perDecade],
      }))
    );
  }
  return rows;
}

async function samplePhotos(executor, count, excludeIds) {
  const rows = await executor.query({
    text: `SELECT i.article_id, i.image_url, i.caption, a.edition_date, a.headline, a.body_plain
           FROM article_images i
           JOIN rag_index_builds b ON b.id = i.index_build_id AND b.status = 'active'
           JOIN articles a ON a.id = i.article_id
           WHERE length(i.caption) >= 40
           ORDER BY md5(i.id || $1)
           LIMIT $2`,
    params: [SEED, count * 3],
  });
  const seen = new Set(excludeIds);
  const picked = [];
  for (const row of rows) {
    if (seen.has(row.article_id)) continue;
    seen.add(row.article_id);
    picked.push(row);
    if (picked.length === count) break;
  }
  return picked;
}

function articlePrompt(row) {
  return [
    `Edition: ${row.edition_date}`,
    `Section: ${row.category}`,
    `Headline: ${row.headline}`,
    row.byline ? `Byline: ${row.byline}` : null,
    "",
    String(row.body_plain).slice(0, MAX_BODY_CHARS),
  ]
    .filter((line) => line !== null)
    .join("\n");
}

function photoPrompt(row) {
  return [
    PHOTO_INSTRUCTIONS,
    "",
    `Edition: ${row.edition_date}`,
    `Caption: ${row.caption}`,
    `Article headline: ${row.headline}`,
    "",
    String(row.body_plain ?? "").slice(0, 4_000),
  ].join("\n");
}

async function draftQuestion(client, prompt, usage) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
    output_config: { effort: "low", format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
  });
  usage.input += response.usage.input_tokens;
  usage.output += response.usage.output_tokens;
  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
  return JSON.parse(text);
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const index = next;
        next += 1;
        if (index >= items.length) return;
        results[index] = await fn(items[index]);
      }
    })
  );
  return results;
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

  const articles = await sampleArticles(executor, args.perDecade);
  const photos = await samplePhotos(
    executor,
    args.photos,
    articles.map((row) => row.id)
  );
  console.error(`Sampled ${articles.length} articles and ${photos.length} photos.`);

  const items = [
    ...articles.map((row) => ({ kind: "text", row })),
    ...photos.map((row) => ({ kind: "visual", row })),
  ];
  const drafted = await mapLimit(items, CONCURRENCY, async ({ kind, row }) => {
    const prompt = kind === "text" ? articlePrompt(row) : photoPrompt(row);
    const draft = await draftQuestion(client, prompt, usage);
    return { kind, row, draft };
  });

  const questions = [];
  const dropped = [];
  for (const { kind, row, draft } of drafted) {
    const articleId = kind === "text" ? row.id : row.article_id;
    const sourceText =
      kind === "text"
        ? `${row.headline}\n${row.body_plain}`
        : `${row.caption}\n${row.headline}\n${row.body_plain ?? ""}`;
    const facts = verifiedFactGroups(draft.facts ?? [], sourceText);
    if (!draft.usable || !draft.question || (kind === "text" && facts.length === 0)) {
      dropped.push(`${articleId}: ${draft.usable ? "no verified facts" : "not usable"}`);
      continue;
    }
    questions.push({
      id: `dev2-${kind === "text" ? "t" : "v"}-${articleId}`,
      question: draft.question.trim(),
      mode: kind,
      minCitations: 1,
      expectedSourceIdsAny: [articleId],
      ...(facts.length > 0 ? { expectedFactsAny: facts } : {}),
      ...(kind === "visual" ? { expectedImagesAny: [row.image_url] } : {}),
      source: `${row.edition_date} — ${row.headline}`,
    });
  }

  const catalog = {
    schemaVersion: 2,
    datasetId: "rag-development-v2",
    split: "development",
    provenance:
      "Drafted by Claude from a seeded, decade-stratified sample of archive articles and captioned photos (scripts/rag/build-dev-catalog.mjs); facts are verified verbatim against the source.",
    questions,
  };
  writeFileSync(args.out, `${JSON.stringify(catalog, null, 2)}\n`);

  if (args.review) {
    const lines = [`# rag-development-v2: ${questions.length} questions`, ""];
    for (const q of questions) {
      lines.push(`- **${q.question}**`);
      lines.push(`  - ${q.mode} · ${q.expectedSourceIdsAny[0]} · ${q.source}`);
      if (q.expectedFactsAny) {
        lines.push(`  - facts: ${q.expectedFactsAny.map((g) => g.join(" / ")).join(" · ")}`);
      }
    }
    writeFileSync(args.review, `${lines.join("\n")}\n`);
  }

  const cost = (usage.input * PRICE.input + usage.output * PRICE.output) / 1e6;
  console.error(
    `Wrote ${questions.length} questions (${dropped.length} dropped) for $${cost.toFixed(3)}.`
  );
  for (const reason of dropped) console.error(`  dropped ${reason}`);
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entryPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
