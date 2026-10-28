#!/usr/bin/env node
// Takes the next N source editions end to end: download from CONTENTdm, OCR
// and publish (process-edition.sh --seed), then back up and verify on R2.
// Run state lives in the local ops.source_editions table; each row is updated
// after every step, so a killed run resumes where it stopped.
//
// Usage: npm run archive:run -- --count N --target local|production [--decade 1980s] [--max-usd X] --yes

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statfsSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvConfig } from "@next/env";
import type { QueryExecutor } from "../db/lib/migration-runner";
import { createNeonExecutor } from "../db/lib/neon-executor";
import { DEFAULT_BASE_URL, DEFAULT_COLLECTION } from "../iiif/inventory-source";
import { ensureOpsSchema } from "./lib/ops-schema";
import {
  EDITION_RESERVE_USD,
  assertLocalRunner,
  failureCostSince,
  inboxFolderName,
  parseRunArgs,
  pickNext,
  statusAfterFailure,
  statusAfterProcess,
  stopReason,
  type CandidateRow,
  type RunArgs,
  type RunTarget,
} from "./lib/run-plan";
import type { SourceStatus } from "./lib/source-editions";

const PYTHON = "ocr/.venv/bin/python";
const DOWNLOAD = "scripts/iiif/download.py";
const PROCESS = "scripts/ocr/process-edition.sh";
const BACKUP = "scripts/db/backup-editions.mjs";
const INBOX = "ocr/inbox";
const FAILURE_LOG = "ocr/logs/failures.jsonl";
const SITE: Record<RunTarget, string> = {
  local: "http://localhost:3000",
  production: "https://interactive-newspaper-sable.vercel.app",
};

export interface RowUpdate {
  status?: SourceStatus;
  attempts?: number;
  local_dir?: string | null;
  last_error?: string | null;
  ocr_cost_usd?: number | null;
  seeded_target?: RunTarget | null;
  last_run_id?: string;
}

export interface RunStore {
  candidates(): Promise<CandidateRow[]>;
  update(pointer: number, fields: RowUpdate): Promise<void>;
  acquireLock(runId: string, pid: number, isAlive: (pid: number) => boolean): Promise<boolean>;
  holdsLock(runId: string): Promise<boolean>;
  releaseLock(runId: string): Promise<void>;
  reviewCount(): Promise<number>;
}

export interface RunDeps {
  store: RunStore;
  /** Runs a command from the repo root; `env` is merged over the parent's. Resolves to the exit code. */
  exec(command: string, args: string[], env?: Record<string, string>): Promise<number>;
  now(): Date;
  freeBytes(): number;
  holdPresent(): boolean;
  readText(file: string): string | null;
  dirExists(dir: string): boolean;
  pidAlive(pid: number): boolean;
  pid: number;
  random(): number;
  prodDatabaseUrl: string | undefined;
  /** Drops production's cached editions list; resolves to a line for the report. */
  revalidate(): Promise<string>;
  writeReport(file: string, text: string): void;
  log(line: string): void;
}

export interface EditionResult {
  pointer: number;
  date: string;
  status: SourceStatus;
  costUsd: number;
  note: string;
  seeded: boolean;
}

export interface RunSummary {
  runId: string;
  reportPath: string;
  results: EditionResult[];
  stopReason: string | null;
  spentUsd: number;
}

const manifestUrl = (pointer: number) =>
  `${DEFAULT_BASE_URL}/iiif/info/${DEFAULT_COLLECTION}/${pointer}/manifest.json`;
const scanUrl = (pointer: number) =>
  `${DEFAULT_BASE_URL}/digital/collection/${DEFAULT_COLLECTION}/id/${pointer}`;

function provenanceCost(deps: RunDeps, date: string): number | null {
  try {
    const cost = JSON.parse(
      deps.readText(path.join("public/editions", date, "provenance.json")) ?? ""
    ).estimated_cost_usd;
    return typeof cost === "number" ? cost : null;
  } catch {
    return null;
  }
}

async function runEdition(
  row: CandidateRow,
  args: RunArgs,
  runId: string,
  deps: RunDeps
): Promise<EditionResult> {
  const date = row.edition_date;
  const attempts = row.attempts + 1;
  const startedAt = deps.now().toISOString();
  const update = (fields: RowUpdate) => deps.store.update(row.pointer, fields);
  const finish = async (
    status: SourceStatus,
    costUsd: number,
    note: string | null,
    fields: RowUpdate = {}
  ): Promise<EditionResult> => {
    await update({ ...fields, status, last_error: note, ocr_cost_usd: costUsd });
    return { pointer: row.pointer, date, status, costUsd, note: note ?? "", seeded: false };
  };
  await update({ attempts, last_run_id: runId });

  let dir = row.local_dir && deps.dirExists(row.local_dir) ? row.local_dir : null;
  if (!dir) {
    const target = path.join(INBOX, inboxFolderName(date, row.pointer));
    const code = await deps.exec(PYTHON, [
      DOWNLOAD,
      manifestUrl(row.pointer),
      "--output-dir",
      target,
      "--pace",
      "1",
    ]);
    if (code !== 0) {
      const outcome = statusAfterFailure(`download exited ${code}`, attempts);
      return finish(outcome.status, 0, outcome.error, { local_dir: null });
    }
    dir = target;
    await update({ status: "downloaded", local_dir: dir });
  }

  const env =
    args.target === "production" ? { DATABASE_URL: deps.prodDatabaseUrl ?? "" } : undefined;
  const code = await deps.exec("bash", [PROCESS, dir, "--seed"], env);
  const outcome = statusAfterProcess(code, attempts);
  const failedCalls = failureCostSince(deps.readText(FAILURE_LOG) ?? "", date, startedAt);
  const recorded = code === 0 || code === 50 ? provenanceCost(deps, date) : null;
  // Without a provenance file the OCR spend is unknown; charge the reserve.
  const cost =
    recorded === null ? Math.max(failedCalls, EDITION_RESERVE_USD) : recorded + failedCalls;

  if (code === 50) {
    return finish(outcome.status, cost, outcome.error, { local_dir: null, seeded_target: null });
  }
  if (code !== 0) return finish(outcome.status, cost, outcome.error);

  // Published: the pipeline has deleted the scans.
  await update({ status: "published", local_dir: null, seeded_target: args.target });
  const backup = await deps.exec("node", [BACKUP, "--date", date, "--verify"]);
  const result =
    backup === 0
      ? await finish("backed_up", cost, null)
      : await finish(
          "needs_review",
          cost,
          `published; R2 backup not verified: run editions:backup -- --date ${date} --verify`
        );
  return { ...result, seeded: true };
}

function pickSpotChecks(results: EditionResult[], count: number, random: () => number) {
  const pool = results.filter((result) => result.seeded);
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

function renderReport(input: {
  runId: string;
  args: RunArgs;
  startedAt: Date;
  finishedAt: Date;
  results: EditionResult[];
  spentUsd: number;
  stop: string | null;
  reviewCount: number;
  revalidateNote: string | null;
  spotChecks: EditionResult[];
}): string {
  const count = (status: SourceStatus) =>
    input.results.filter((result) => result.status === status).length;
  const minutes = Math.round((input.finishedAt.getTime() - input.startedAt.getTime()) / 60_000);
  const lines = [
    `# Archive run ${input.runId}`,
    "",
    `- Target: ${input.args.target}${input.args.decade ? `, decade ${input.args.decade}` : ""}`,
    `- Time: ${input.startedAt.toISOString()} to ${input.finishedAt.toISOString()} (${minutes} min)`,
    `- Result: ${count("backed_up")} backed up, ${count("failed")} failed, ${count("needs_review")} need review (of ${input.results.length} run, ${input.args.count} asked)`,
    `- Cost: $${input.spentUsd.toFixed(2)} of the $${input.args.maxUsd.toFixed(2)} cap`,
    `- Stopped: ${input.stop ?? "finished the editions it picked"}`,
    `- Review list: ${input.reviewCount} edition(s) in needs_review`,
  ];
  if (input.revalidateNote) lines.push(`- Revalidate: ${input.revalidateNote}`);
  lines.push("", "| Date | Pointer | Result | Cost | Note |", "|---|---|---|---|---|");
  for (const result of input.results) {
    lines.push(
      `| ${result.date} | ${result.pointer} | ${result.status} | $${result.costUsd.toFixed(2)} | ${result.note} |`
    );
  }
  lines.push("", "## Spot-check against the scans", "");
  if (input.spotChecks.length === 0) lines.push("Nothing was published.");
  for (const result of input.spotChecks) {
    lines.push(
      `- ${result.date}: scans ${scanUrl(result.pointer)} · site ${SITE[input.args.target]}/edition/${result.date}`
    );
  }
  return `${lines.join("\n")}\n`;
}

export async function runArchive(args: RunArgs, deps: RunDeps): Promise<RunSummary> {
  if (args.target === "production" && !deps.prodDatabaseUrl) {
    throw new Error("--target production needs PROD_DATABASE_URL in .env.local");
  }
  const startedAt = deps.now();
  const runId = `run-${startedAt.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15)}`;
  if (!(await deps.store.acquireLock(runId, deps.pid, deps.pidAlive))) {
    throw new Error("another archive:run holds the run lock (ops.run_lock) and is still alive");
  }

  const results: EditionResult[] = [];
  let spentUsd = 0;
  let consecutiveFailures = 0;
  let stop: string | null = null;
  try {
    const queue = pickNext(await deps.store.candidates(), args);
    if (queue.length === 0) stop = "no runnable editions left";
    deps.log(
      `[archive:run] ${runId}: ${queue.length} edition(s), target ${args.target}, cap $${args.maxUsd.toFixed(2)}`
    );
    for (const row of queue) {
      stop = stopReason({
        holdPresent: deps.holdPresent(),
        ownsLock: await deps.store.holdsLock(runId),
        freeBytes: deps.freeBytes(),
        spentUsd,
        maxUsd: args.maxUsd,
        consecutiveFailures,
      });
      if (stop) break;
      deps.log(`[archive:run] ${row.edition_date} (pointer ${row.pointer}) starting`);
      const result = await runEdition(row, args, runId, deps);
      results.push(result);
      spentUsd += result.costUsd;
      consecutiveFailures = result.status === "backed_up" ? 0 : consecutiveFailures + 1;
      deps.log(
        `[archive:run] ${result.date}: ${result.status} $${result.costUsd.toFixed(2)}${result.note ? ` (${result.note})` : ""}`
      );
    }
    if (stop) deps.log(`[archive:run] stopped: ${stop}`);

    const revalidateNote =
      args.target === "production" && results.some((result) => result.seeded)
        ? await deps.revalidate()
        : null;
    const reportPath = `ocr/reports/${runId}.md`;
    deps.writeReport(
      reportPath,
      renderReport({
        runId,
        args,
        startedAt,
        finishedAt: deps.now(),
        results,
        spentUsd,
        stop,
        reviewCount: await deps.store.reviewCount(),
        revalidateNote,
        spotChecks: pickSpotChecks(results, 3, deps.random),
      })
    );
    return { runId, reportPath, results, stopReason: stop, spentUsd };
  } finally {
    await deps.store.releaseLock(runId);
  }
}

function sqlStore(executor: QueryExecutor): RunStore {
  return {
    async candidates() {
      const rows = await executor.query({
        text: `SELECT pointer, edition_date, status, attempts, local_dir FROM ops.source_editions
               WHERE status IN ('downloaded', 'pending', 'failed')`,
      });
      return rows.map((row) => ({
        pointer: Number(row.pointer),
        edition_date: String(row.edition_date),
        status: row.status as SourceStatus,
        attempts: Number(row.attempts),
        local_dir: row.local_dir ? String(row.local_dir) : null,
      }));
    },
    async update(pointer, fields) {
      // Column names come from RowUpdate's keys, never from input.
      const entries = Object.entries(fields);
      await executor.query({
        text: `UPDATE ops.source_editions
               SET ${entries.map(([column], i) => `${column} = $${i + 2}`).join(", ")}, updated_at = now()
               WHERE pointer = $1`,
        params: [pointer, ...entries.map(([, value]) => value)],
      });
    },
    async acquireLock(runId, pid, isAlive) {
      const [held] = await executor.query({ text: "SELECT pid FROM ops.run_lock WHERE id = 1" });
      if (held && isAlive(Number(held.pid))) return false;
      await executor.query({
        text: `INSERT INTO ops.run_lock (id, run_id, pid) VALUES (1, $1, $2)
               ON CONFLICT (id) DO UPDATE SET run_id = EXCLUDED.run_id, pid = EXCLUDED.pid, started_at = now()`,
        params: [runId, pid],
      });
      return true;
    },
    async holdsLock(runId) {
      const rows = await executor.query({
        text: "SELECT 1 FROM ops.run_lock WHERE id = 1 AND run_id = $1",
        params: [runId],
      });
      return rows.length === 1;
    },
    async releaseLock(runId) {
      await executor.query({
        text: "DELETE FROM ops.run_lock WHERE id = 1 AND run_id = $1",
        params: [runId],
      });
    },
    async reviewCount() {
      const [row] = await executor.query({
        text: "SELECT count(*)::int AS n FROM ops.source_editions WHERE status = 'needs_review'",
      });
      return Number(row?.n ?? 0);
    },
  };
}

function realDeps(executor: QueryExecutor): RunDeps {
  return {
    store: sqlStore(executor),
    exec: (command, args, env) =>
      new Promise((resolve) => {
        const child = spawn(command, args, { stdio: "inherit", env: { ...process.env, ...env } });
        child.on("error", () => resolve(127));
        child.on("close", (code, signal) => resolve(code ?? (signal ? 128 : 1)));
      }),
    now: () => new Date(),
    freeBytes: () => {
      const stats = statfsSync(".");
      return stats.bavail * stats.bsize;
    },
    holdPresent: () => existsSync("ocr/.hold"),
    readText: (file) => {
      try {
        return readFileSync(file, "utf8");
      } catch {
        return null;
      }
    },
    dirExists: (dir) => existsSync(dir) && statSync(dir).isDirectory(),
    pidAlive: (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        return (error as NodeJS.ErrnoException).code === "EPERM";
      }
    },
    pid: process.pid,
    random: Math.random,
    prodDatabaseUrl: process.env.PROD_DATABASE_URL || undefined,
    async revalidate() {
      const token = process.env.ADMIN_REVALIDATE_TOKEN;
      if (!token) {
        return "skipped: ADMIN_REVALIDATE_TOKEN is not set; the editions list refreshes within the hour";
      }
      try {
        const response = await fetch(`${SITE.production}/api/admin/revalidate`, {
          method: "POST",
          headers: { "X-Admin-Token": token },
        });
        return response.ok ? "editions cache revalidated" : `failed: HTTP ${response.status}`;
      } catch (error) {
        return `failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    writeReport: (file, text) => {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, text);
    },
    log: (line) => console.log(line),
  };
}

async function main() {
  loadEnvConfig(process.cwd(), true, { info() {}, error: console.error });
  const args = parseRunArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL ?? "";
  assertLocalRunner(databaseUrl);
  const executor = createNeonExecutor(databaseUrl);
  await ensureOpsSchema(executor);
  // Keep the Mac awake for as long as this process lives.
  spawn("caffeinate", ["-i", "-w", String(process.pid)], { stdio: "ignore", detached: true })
    .on("error", () => {})
    .unref();

  const summary = await runArchive(args, realDeps(executor));
  console.log(`[archive:run] report: ${summary.reportPath}`);
  if (summary.results.some((result) => result.status !== "backed_up")) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[archive:run] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
