// Pure rules for archive:run: arguments, which editions go next, what an exit
// code means for a row, and when a run must stop.

import { describeDatabaseTarget, isLocalDatabaseUrl } from "../../../src/lib/sql";
import type { SourceStatus } from "./source-editions";

export type RunTarget = "local" | "production";

export interface RunArgs {
  count: number;
  target: RunTarget;
  decade: string | null;
  maxUsd: number;
}

export interface CandidateRow {
  pointer: number;
  edition_date: string;
  status: SourceStatus;
  attempts: number;
  local_dir: string | null;
}

export interface GuardState {
  holdPresent: boolean;
  ownsLock: boolean;
  freeBytes: number;
  spentUsd: number;
  maxUsd: number;
  consecutiveFailures: number;
}

export const MAX_COUNT = 50;
export const MAX_ATTEMPTS = 3;
/** Budget held back for each edition before it starts. */
export const EDITION_RESERVE_USD = 0.75;
export const MIN_FREE_BYTES = 10 * 1024 ** 3;
export const MAX_CONSECUTIVE_FAILURES = 3;
/** Pre-1950 decades run only when named with --decade. */
export const DECADE_ORDER = ["1980s", "1970s", "1990s", "1960s", "2000s", "1950s"];

const RUNNABLE_RANK: Partial<Record<SourceStatus, number>> = {
  downloaded: 0,
  pending: 1,
  failed: 2,
};

export function parseRunArgs(argv: string[]): RunArgs {
  const value = (flag: string) => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };
  const count = Number(value("--count"));
  if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) {
    throw new Error(`--count is required, a whole number from 1 to ${MAX_COUNT}`);
  }
  const target = value("--target");
  if (target !== "local" && target !== "production") {
    throw new Error("--target must be local or production");
  }
  const decade = value("--decade") ?? null;
  if (decade !== null && !/^\d{3}0s$/.test(decade)) {
    throw new Error("--decade must look like 1980s");
  }
  const rawMax = value("--max-usd");
  const maxUsd = rawMax === undefined ? EDITION_RESERVE_USD * count : Number(rawMax);
  if (!Number.isFinite(maxUsd) || maxUsd <= 0) {
    throw new Error("--max-usd must be a positive number");
  }
  if (!argv.includes("--yes")) {
    throw new Error("--yes is required: this run spends money and publishes editions");
  }
  return { count, target, decade, maxUsd };
}

const decadeOf = (date: string) => `${date.slice(0, 3)}0s`;

export function pickNext(
  rows: CandidateRow[],
  options: { count: number; decade: string | null }
): CandidateRow[] {
  const decadeRank = (date: string) => (options.decade ? 0 : DECADE_ORDER.indexOf(decadeOf(date)));
  return rows
    .filter((row) => RUNNABLE_RANK[row.status] !== undefined)
    .filter((row) => row.status !== "failed" || row.attempts < MAX_ATTEMPTS)
    .filter((row) =>
      options.decade
        ? decadeOf(row.edition_date) === options.decade
        : DECADE_ORDER.includes(decadeOf(row.edition_date))
    )
    .sort(
      (a, b) =>
        RUNNABLE_RANK[a.status]! - RUNNABLE_RANK[b.status]! ||
        decadeRank(a.edition_date) - decadeRank(b.edition_date) ||
        a.edition_date.localeCompare(b.edition_date) ||
        a.pointer - b.pointer
    )
    .slice(0, options.count);
}

/** A failure that is retried, until its last attempt sends it to review. */
export function statusAfterFailure(
  error: string,
  attempts: number
): { status: SourceStatus; error: string } {
  return attempts >= MAX_ATTEMPTS
    ? { status: "needs_review", error: `${error} (${attempts} attempts)` }
    : { status: "failed", error };
}

export interface ProcessOutcome {
  status: SourceStatus;
  error: string | null;
  /** Set when the run must stop; the edition keeps its scans and its attempt. */
  stop?: string;
}

/** Exits that are not the edition's fault: a signal, a bad setup, or no bash. */
function runStopFor(exitCode: number): string | null {
  if (exitCode >= 128 && exitCode < 160) return "interrupted";
  if (exitCode === 2) return "process-edition preflight failed (exit 2)";
  if (exitCode === 127) return "could not start process-edition (exit 127)";
  return null;
}

export function statusAfterProcess(exitCode: number, attempts: number): ProcessOutcome {
  if (exitCode === 0) return { status: "published", error: null };
  if (exitCode === 20)
    return { status: "needs_review", error: "failed publish checks; scans kept" };
  if (exitCode === 50) {
    return { status: "needs_review", error: "published, seed failed: run --repair-seed" };
  }
  // The OCR is paid for, and the lock may have failed after promotion: a blind retry pays twice.
  if (exitCode === 75) {
    return {
      status: "needs_review",
      error: "asset lock (exit 75): check public/editions before a rerun",
    };
  }
  const stop = runStopFor(exitCode);
  if (stop) return { status: "downloaded", error: stop, stop };
  return statusAfterFailure(`process-edition exited ${exitCode}`, attempts);
}

export function stopReason(state: GuardState): string | null {
  if (state.holdPresent) return "ocr/.hold is present";
  if (!state.ownsLock) return "this run no longer holds the run lock";
  if (state.freeBytes < MIN_FREE_BYTES) {
    return `free disk ${(state.freeBytes / 1024 ** 3).toFixed(1)} GB is under 10 GB`;
  }
  if (state.spentUsd + EDITION_RESERVE_USD > state.maxUsd) {
    return `spent $${state.spentUsd.toFixed(2)} + $${EDITION_RESERVE_USD} reserve would pass the $${state.maxUsd.toFixed(2)} cap`;
  }
  if (state.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    return `${state.consecutiveFailures} failures in a row`;
  }
  return null;
}

/** Cost of failed model calls for one date, from ocr/logs/failures.jsonl. */
export function failureCostSince(jsonl: string, date: string, sinceIso: string): number {
  const since = Date.parse(sinceIso);
  let total = 0;
  for (const line of jsonl.split("\n")) {
    let entry: { timestamp?: string; edition?: string; estimated_cost_usd?: unknown };
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry?.edition !== date || typeof entry.estimated_cost_usd !== "number") continue;
    if (Date.parse(entry.timestamp ?? "") >= since) total += entry.estimated_cost_usd;
  }
  return total;
}

export function inboxFolderName(date: string, pointer: number): string {
  return `${date} contentdm-${pointer}`;
}

export function assertLocalRunner(databaseUrl: string): void {
  if (!isLocalDatabaseUrl(databaseUrl)) {
    throw new Error(
      `archive:run keeps run state in the local database; DATABASE_URL is ${describeDatabaseTarget(databaseUrl)}. Use --target production instead of with-prod.`
    );
  }
}
