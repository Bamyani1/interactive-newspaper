#!/usr/bin/env node
/**
 * Post every landing prompt at a running /api/ask and report what came
 * back — the answer to "do all the questions actually work?".
 *
 * This is the check the unit suite cannot make: it needs the real index,
 * the real model, and the real retrieval config. A prompt that returns a
 * canned "I don't have enough information" in 400ms looks identical to a
 * healthy pipeline from inside a test double.
 *
 *   npm run rag:smoke                      # every prompt in the pool
 *   npm run rag:smoke -- --limit 5         # first 5, for a quick look
 *   npm run rag:smoke -- --json            # machine-readable
 *   npm run rag:smoke -- --base http://localhost:3001
 *
 * Exit codes: 0 all rows healthy · 1 at least one row failed a criterion
 * · 2 the run could not be made at all.
 *
 * Costs real money — roughly a cent per question. It never writes to the
 * database and never starts a server; point it at one you already have.
 */

import { QUESTION_POOL } from "../../src/features/ask-archive/data/question-pool.ts";

// The three that returned nothing when this audit started. They are the
// regression cases: each needs semantic retrieval, and each returned a
// canned refusal while the vector leg was dark.
const REGRESSION_QUESTIONS = [
  "Find photographs of campus spaces that look very different today",
  "What did students worry about most in the 1970s?",
  "Show how campus fashion changed from the 1950s to the 1990s.",
];

const HEALTHY_METHODS = new Set(["hybrid", "vector"]);

function parseArgs(argv) {
  const args = { base: "http://localhost:3000", limit: Infinity, json: false, followUps: true };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") args.json = true;
    else if (arg === "--no-follow-ups") args.followUps = false;
    else if (arg === "--base") args.base = argv[++i];
    else if (arg === "--limit") args.limit = Number(argv[++i]);
    else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  if (!Number.isFinite(args.limit) && args.limit !== Infinity) {
    console.error("--limit must be a number");
    process.exit(2);
  }
  return args;
}

/**
 * Consume one SSE answer, keeping the stage timings on the way past.
 * `elapsedMs` is measured server-side from the start of the request, so
 * the differences between consecutive stages are the stage durations.
 */
async function askOnce(base, question, sessionId) {
  const startedAt = Date.now();
  const response = await fetch(`${base}/api/ask?stream=1`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, ...(sessionId ? { sessionId } : {}) }),
  });

  if (!response.ok || !response.body) {
    // Say *why*. A run that trips the daily budget returns twenty
    // identical 60ms rows, and "http_error" alone sends the reader
    // looking at retrieval instead of at the spend counter.
    const body = await response.json().catch(() => null);
    return {
      question,
      outcome: "http_error",
      httpStatus: response.status,
      errorKind: body?.kind,
      errorMessage: body?.message ?? body?.error,
      totalMs: Date.now() - startedAt,
    };
  }

  const row = {
    question,
    stages: {},
    firstDeltaMs: null,
    citations: 0,
    answerChars: 0,
    outcome: null,
  };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const line = frame.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      let event;
      try {
        event = JSON.parse(line.slice(6));
      } catch {
        continue;
      }
      if (event.type === "stage") {
        row.stages[event.name] = event.elapsedMs;
      } else if (event.type === "metadata") {
        row.mode = event.mode;
        row.requestId = event.requestId;
        row.sources = event.sourceArticles?.length ?? 0;
        row.method = event.meta?.method;
        row.articlesSearched = event.meta?.articlesSearched;
        row.retrievalTimeMs = event.meta?.retrievalTimeMs;
        row.retrievalTarget = event.meta?.retrievalTarget;
        row.indexBuildId = event.meta?.indexBuildId;
        row.rerankDegraded = event.meta?.rerankDegraded;
        row.reformulationDegraded = event.meta?.reformulationDegraded;
      } else if (event.type === "delta") {
        if (row.firstDeltaMs === null) row.firstDeltaMs = Date.now() - startedAt;
        row.answerChars += event.text.length;
      } else if (event.type === "done") {
        row.citations = event.citations?.length ?? 0;
        row.confidence = event.confidence;
        row.answerChars = event.answer?.length ?? row.answerChars;
        row.outcome = event.outcome ?? "answered";
        row.method ??= event.meta?.method;
      } else if (event.type === "error") {
        row.outcome = "error";
        row.errorKind = event.kind;
        row.errorStage = event.stage;
      }
    }
  }

  row.totalMs = Date.now() - startedAt;
  row.outcome ??= "no_terminal_frame";
  row.isAgent = row.stages.agent !== undefined;
  row.path = row.isAgent ? "agent" : "pipeline";
  return row;
}

/**
 * A row is healthy when it cited something, and — on the pipeline path —
 * when the vector leg contributed.
 *
 * The agent path does its retrieval inside tool calls, so it reports no
 * top-level retrieval method. Judging it by one marked every agent answer
 * as broken, including answers carrying thirteen citations.
 */
function judge(row) {
  const problems = [];
  if (row.outcome === "http_error") {
    problems.push(`HTTP ${row.httpStatus}${row.errorKind ? ` (${row.errorKind})` : ""}`);
  }
  else if (row.outcome === "error") problems.push(`error:${row.errorKind ?? "unknown"}`);
  else if (row.outcome === "no_terminal_frame") problems.push("stream ended without done");
  else {
    if (!row.isAgent && !HEALTHY_METHODS.has(row.method)) {
      problems.push(`method=${row.method ?? "none"}`);
    }
    if (row.outcome !== "no_evidence" && row.citations === 0) problems.push("no citations");
  }
  if (row.rerankDegraded) problems.push("rerank degraded");
  if (row.reformulationDegraded) problems.push("reformulation degraded");
  return problems;
}

function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

/** Stage durations are the gaps between consecutive server-side marks. */
function stageDurations(row) {
  const order = ["reformulate", "coverage", "retrieve", "rerank", "agent", "generate"];
  const marks = order.filter((name) => row.stages?.[name] !== undefined);
  const out = {};
  let previous = 0;
  for (const name of marks) {
    out[name] = row.stages[name] - previous;
    previous = row.stages[name];
  }
  return out;
}

function pad(value, width) {
  return String(value ?? "").padEnd(width);
}

function printTable(rows) {
  console.log(
    `\n${pad("QUESTION", 52)} ${pad("PATH", 9)} ${pad("METHOD", 8)} ${pad("FOUND", 7)} ${pad("CITES", 6)} ${pad("CONF", 7)} ${pad("OUTCOME", 12)} ${pad("TOTAL", 8)}`
  );
  console.log("-".repeat(120));
  for (const row of rows) {
    const question = row.question.length > 50 ? `${row.question.slice(0, 49)}…` : row.question;
    console.log(
      `${pad(question, 52)} ${pad(row.path, 9)} ${pad(row.method ?? "—", 8)} ${pad(row.articlesSearched ?? "-", 7)} ${pad(row.citations, 6)} ${pad(row.confidence, 7)} ${pad(row.outcome, 12)} ${pad(
        `${row.totalMs}ms`,
        8
      )}`
    );
  }
}

function printLatency(rows) {
  const names = ["reformulate", "coverage", "retrieve", "rerank", "agent", "generate"];
  const durations = rows.map(stageDurations);
  console.log(`\n${pad("STAGE", 22)} ${pad("p50", 10)} ${pad("p95", 10)} ${pad("n", 5)}`);
  console.log("-".repeat(50));
  for (const name of names) {
    const values = durations.map((d) => d[name]).filter((v) => v !== undefined);
    if (values.length === 0) continue;
    console.log(
      `${pad(name, 22)} ${pad(`${percentile(values, 50)}ms`, 10)} ${pad(`${percentile(values, 95)}ms`, 10)} ${pad(values.length, 5)}`
    );
  }
  const firstDeltas = rows.map((r) => r.firstDeltaMs).filter((v) => v !== null && v !== undefined);
  const totals = rows.map((r) => r.totalMs).filter(Boolean);
  console.log(
    `${pad("time to first word", 22)} ${pad(`${percentile(firstDeltas, 50)}ms`, 10)} ${pad(`${percentile(firstDeltas, 95)}ms`, 10)} ${pad(firstDeltas.length, 5)}`
  );
  console.log(
    `${pad("total", 22)} ${pad(`${percentile(totals, 50)}ms`, 10)} ${pad(`${percentile(totals, 95)}ms`, 10)} ${pad(totals.length, 5)}`
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const questions = [...new Set([...QUESTION_POOL, ...REGRESSION_QUESTIONS])].slice(0, args.limit);

  try {
    const probe = await fetch(`${args.base}/api/ask`, { method: "OPTIONS" });
    void probe;
  } catch {
    console.error(`No server answering at ${args.base}. Start one with \`npm run dev\`.`);
    process.exit(2);
  }

  const rows = [];
  for (const question of questions) {
    const row = await askOnce(args.base, question);
    row.problems = judge(row);
    rows.push(row);
    if (row.errorKind === "budget") {
      console.error(
        `\nDaily AI budget reached — every remaining question would return the same 429.\n` +
          `Raise RAG_DAILY_BUDGET_USD for the run, or continue tomorrow. Stopping here.`
      );
      break;
    }
    if (!args.json) {
      const status = row.problems.length === 0 ? "ok  " : "FAIL";
      console.log(`${status} ${row.totalMs}ms  ${question}`);
      if (row.problems.length > 0) console.log(`      ${row.problems.join(", ")}`);
    }
  }

  // One multi-turn pair: a follow-up must inherit the first question's
  // subject, which is the whole point of server-side recall.
  let followUp = null;
  if (args.followUps && questions.length > 0) {
    const sessionId = `smoke-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    // A pair the archive can actually answer. An opener it has to refuse
    // proves nothing about recall — the follow-up then has no subject to
    // inherit, and the check reads as a failure of memory rather than of
    // coverage.
    const first = await askOnce(
      args.base,
      "What arguments did students make for and against the Vietnam War?",
      sessionId
    );
    const second = await askOnce(
      args.base,
      "Which of those arguments came up most often?",
      sessionId
    );
    followUp = {
      sessionId,
      first: { outcome: first.outcome, citations: first.citations },
      second: { outcome: second.outcome, citations: second.citations },
      // "Which of those" is unanswerable without the first turn, so an
      // answer at all is the evidence. Citations are coverage, not recall.
      carriedContext: second.outcome === "answered",
    };
    if (!args.json) {
      console.log(
        `\nfollow-up context: ${followUp.carriedContext ? "carried" : "NOT CARRIED"} ` +
          `(opener ${first.outcome}, follow-up ${second.outcome}, ${second.citations} citations)`
      );
    }
  }

  const failed = rows.filter((row) => row.problems.length > 0);

  if (args.json) {
    console.log(JSON.stringify({ rows, followUp, failed: failed.length }, null, 2));
  } else {
    printTable(rows);
    printLatency(rows);
    console.log(
      `\n${rows.length - failed.length}/${rows.length} healthy` +
        (failed.length > 0 ? `; ${failed.length} need attention` : "")
    );
  }

  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
