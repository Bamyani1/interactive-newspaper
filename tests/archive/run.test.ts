import path from "node:path";
import { describe, expect, it } from "vitest";
import type { CandidateRow, RunArgs } from "../../scripts/archive/lib/run-plan";
import { runArchive, type RowUpdate, type RunDeps, type RunStore } from "../../scripts/archive/run";

type Row = CandidateRow & RowUpdate;
interface Call {
  script: string;
  args: string[];
  env?: Record<string, string>;
}

const GB = 1024 ** 3;
const pending = (pointer: number, edition_date: string): CandidateRow => ({
  pointer,
  edition_date,
  status: "pending",
  attempts: 0,
  local_dir: null,
});

function harness(
  rows: CandidateRow[],
  options: {
    processExit?: (date: string) => number;
    downloadExit?: number;
    cost?: number;
    failedCallCost?: number;
    freeBytes?: () => number;
    hold?: () => boolean;
    lockedBy?: { pid: number; alive: boolean };
    existingDirs?: string[];
  } = {}
) {
  const state = new Map<number, Row>(rows.map((row) => [row.pointer, { ...row }]));
  const calls: Call[] = [];
  const files = new Map<string, string>();
  const reports = new Map<string, string>();
  const revalidations: string[] = [];
  let lock = options.lockedBy ? { runId: "old-run", pid: options.lockedBy.pid } : null;
  let clock = Date.parse("2026-10-28T12:00:00Z");

  const store: RunStore = {
    async candidates() {
      return [...state.values()].map((row) => ({ ...row }));
    },
    async update(pointer, fields) {
      Object.assign(state.get(pointer)!, fields);
    },
    async acquireLock(runId, pid, isAlive) {
      if (lock && isAlive(lock.pid)) return false;
      lock = { runId, pid };
      return true;
    },
    async holdsLock(runId) {
      return lock?.runId === runId;
    },
    async releaseLock(runId) {
      if (lock?.runId === runId) lock = null;
    },
    async reviewCount() {
      return [...state.values()].filter((row) => row.status === "needs_review").length;
    },
  };

  const deps: RunDeps = {
    store,
    async exec(_command, args, env) {
      const script = path.basename(args[0] ?? "");
      calls.push({ script, args, env });
      if (script === "download.py") return options.downloadExit ?? 0;
      if (script === "process-edition.sh") {
        const date = path.basename(args[1]).slice(0, 10);
        if (options.failedCallCost) {
          const line = JSON.stringify({
            timestamp: new Date(clock).toISOString(),
            edition: date,
            estimated_cost_usd: options.failedCallCost,
          });
          files.set(
            "ocr/logs/failures.jsonl",
            `${files.get("ocr/logs/failures.jsonl") ?? ""}${line}\n`
          );
        }
        const code = options.processExit?.(date) ?? 0;
        if (code === 0 || code === 50) {
          files.set(
            `public/editions/${date}/provenance.json`,
            JSON.stringify({ estimated_cost_usd: options.cost ?? 0.4 })
          );
        }
        return code;
      }
      return 0;
    },
    now: () => new Date((clock += 60_000)),
    freeBytes: options.freeBytes ?? (() => 50 * GB),
    holdPresent: options.hold ?? (() => false),
    readText: (file) => files.get(file) ?? null,
    dirExists: (dir) => options.existingDirs?.includes(dir) ?? false,
    pidAlive: (pid) => (options.lockedBy?.pid === pid ? options.lockedBy.alive : false),
    pid: 4242,
    random: () => 0,
    prodDatabaseUrl: "postgresql://prod.example/neondb",
    async revalidate() {
      revalidations.push("called");
      return "editions cache revalidated";
    },
    writeReport: (file, text) => reports.set(file, text),
    log: () => {},
  };
  return { deps, state, calls, reports, revalidations, lock: () => lock };
}

const args = (overrides: Partial<RunArgs> = {}): RunArgs => ({
  count: 3,
  target: "local",
  decade: null,
  maxUsd: 2.25,
  ...overrides,
});

describe("runArchive", () => {
  it("runs three editions where the second fails: two backed up, one failed, all in the report", async () => {
    const h = harness(
      [pending(1, "1980-01-01"), pending(2, "1980-02-01"), pending(3, "1980-03-01")],
      { processExit: (date) => (date === "1980-02-01" ? 10 : 0) }
    );

    const summary = await runArchive(args(), h.deps);

    expect([1, 2, 3].map((p) => h.state.get(p)!.status)).toEqual([
      "backed_up",
      "failed",
      "backed_up",
    ]);
    expect(h.state.get(1)).toMatchObject({ seeded_target: "local", attempts: 1, local_dir: null });
    expect(h.state.get(2)).toMatchObject({
      attempts: 1,
      last_error: "process-edition exited 10",
      local_dir: path.join("ocr/inbox", "1980-02-01 contentdm-2"),
    });
    const report = h.reports.get(summary.reportPath)!;
    expect(summary.reportPath).toMatch(/^ocr\/reports\/run-.+\.md$/);
    expect(report).toContain("2 backed up, 1 failed, 0 need review");
    expect(report).toContain("| 1980-02-01 | 2 | failed |");
    expect(report).toContain("process-edition exited 10");
    expect(report).toContain(
      "https://cdm15963.contentdm.oclc.org/digital/collection/p15963coll9/id/1"
    );
    expect(report).toContain("http://localhost:3000/edition/1980-01-01");
    expect(h.lock()).toBeNull();
    expect(h.revalidations).toEqual([]);
  });

  it("passes PROD_DATABASE_URL to the process step only, then revalidates production", async () => {
    const h = harness([pending(1, "1981-01-01")]);

    const summary = await runArchive(args({ count: 1, target: "production" }), h.deps);

    expect(h.calls.map((call) => [call.script, call.env?.DATABASE_URL])).toEqual([
      ["download.py", undefined],
      ["process-edition.sh", "postgresql://prod.example/neondb"],
      ["backup-editions.mjs", undefined],
    ]);
    expect(h.calls[0].args).toEqual([
      "scripts/iiif/download.py",
      "https://cdm15963.contentdm.oclc.org/iiif/info/p15963coll9/1/manifest.json",
      "--output-dir",
      path.join("ocr/inbox", "1981-01-01 contentdm-1"),
      "--pace",
      "1",
    ]);
    expect(h.calls[2].args).toEqual([
      "scripts/db/backup-editions.mjs",
      "--date",
      "1981-01-01",
      "--verify",
    ]);
    expect(h.state.get(1)).toMatchObject({ status: "backed_up", seeded_target: "production" });
    expect(h.revalidations).toEqual(["called"]);
    expect(h.reports.get(summary.reportPath)).toContain("editions cache revalidated");
    expect(h.reports.get(summary.reportPath)).toContain(
      "https://interactive-newspaper-sable.vercel.app/edition/1981-01-01"
    );
  });

  it("refuses a production run without PROD_DATABASE_URL", async () => {
    const h = harness([pending(1, "1981-01-01")]);
    await expect(
      runArchive(args({ target: "production" }), { ...h.deps, prodDatabaseUrl: undefined })
    ).rejects.toThrow("PROD_DATABASE_URL");
    expect(h.calls).toEqual([]);
  });

  it("adds failed-call costs from failures.jsonl to the edition's cost", async () => {
    const h = harness([pending(1, "1982-01-01")], { cost: 0.4, failedCallCost: 0.05 });
    const summary = await runArchive(args({ count: 1 }), h.deps);
    expect(h.state.get(1)!.ocr_cost_usd).toBeCloseTo(0.45);
    expect(summary.spentUsd).toBeCloseTo(0.45);
  });

  it("charges the reserve when OCR ran but left no provenance", async () => {
    const h = harness([pending(1, "1982-01-01")], { processExit: () => 20 });
    const summary = await runArchive(args({ count: 1 }), h.deps);
    expect(h.state.get(1)).toMatchObject({
      status: "needs_review",
      last_error: "failed publish checks; scans kept",
      ocr_cost_usd: 0.75,
    });
    expect(summary.spentUsd).toBe(0.75);
  });

  it("sends a seed failure to review without backing it up or retrying OCR", async () => {
    const h = harness([pending(1, "1982-01-01")], { processExit: () => 50 });
    await runArchive(args({ count: 1 }), h.deps);
    expect(h.state.get(1)).toMatchObject({
      status: "needs_review",
      last_error: "published, seed failed: run --repair-seed",
      seeded_target: null,
      local_dir: null,
    });
    expect(h.calls.map((call) => call.script)).toEqual(["download.py", "process-edition.sh"]);
  });

  it("marks a failed download and skips OCR for that edition", async () => {
    const h = harness([pending(1, "1982-01-01")], { downloadExit: 1 });
    await runArchive(args({ count: 1 }), h.deps);
    expect(h.state.get(1)).toMatchObject({
      status: "failed",
      last_error: "download exited 1",
      local_dir: null,
      ocr_cost_usd: 0,
    });
    expect(h.calls.map((call) => call.script)).toEqual(["download.py"]);
  });

  it("reuses a scan folder that already exists instead of downloading again", async () => {
    const dir = "ocr/inbox/1983-09-22 The Transcript Delaware OH 1983-09-22";
    const h = harness([{ ...pending(1, "1983-09-22"), status: "downloaded", local_dir: dir }], {
      existingDirs: [dir],
    });
    await runArchive(args({ count: 1 }), h.deps);
    expect(h.calls.map((call) => call.script)).toEqual([
      "process-edition.sh",
      "backup-editions.mjs",
    ]);
    expect(h.calls[0].args).toEqual(["scripts/ocr/process-edition.sh", dir, "--seed"]);
  });

  it("stops when ocr/.hold appears between editions", async () => {
    let checks = 0;
    const h = harness([pending(1, "1980-01-01"), pending(2, "1980-02-01")], {
      hold: () => checks++ >= 1,
    });
    const summary = await runArchive(args({ count: 2 }), h.deps);
    expect(summary.results).toHaveLength(1);
    expect(summary.stopReason).toContain("ocr/.hold");
    expect(h.reports.get(summary.reportPath)).toContain("ocr/.hold");
  });

  it("does not start under 10 GB of free disk", async () => {
    const h = harness([pending(1, "1980-01-01")], { freeBytes: () => 9 * GB });
    const summary = await runArchive(args({ count: 1 }), h.deps);
    expect(summary.results).toEqual([]);
    expect(summary.stopReason).toContain("10 GB");
    expect(h.calls).toEqual([]);
  });

  it("stops before an edition that could pass the spend cap", async () => {
    const h = harness([pending(1, "1980-01-01"), pending(2, "1980-02-01")], { cost: 0.9 });
    const summary = await runArchive(args({ count: 2, maxUsd: 1.5 }), h.deps);
    expect(summary.results).toHaveLength(1);
    expect(summary.stopReason).toContain("$1.50 cap");
  });

  it("stops after three failures in a row", async () => {
    const h = harness(
      [1, 2, 3, 4].map((p) => pending(p, `1980-0${p}-01`)),
      { processExit: () => 10 }
    );
    const summary = await runArchive(args({ count: 4, maxUsd: 10 }), h.deps);
    expect(summary.results).toHaveLength(3);
    expect(summary.stopReason).toContain("3 failures in a row");
    expect(h.state.get(4)!.status).toBe("pending");
  });

  it("refuses to start while a live run holds the lock, and takes over a dead one's", async () => {
    const live = harness([pending(1, "1980-01-01")], { lockedBy: { pid: 99, alive: true } });
    await expect(runArchive(args({ count: 1 }), live.deps)).rejects.toThrow("lock");
    expect(live.calls).toEqual([]);

    const dead = harness([pending(1, "1980-01-01")], { lockedBy: { pid: 99, alive: false } });
    await runArchive(args({ count: 1 }), dead.deps);
    expect(dead.state.get(1)!.status).toBe("backed_up");
  });
});
