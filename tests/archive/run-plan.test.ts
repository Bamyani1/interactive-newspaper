import { describe, expect, it } from "vitest";
import {
  assertLocalRunner,
  failureCostSince,
  inboxFolderName,
  parseRunArgs,
  pickNext,
  statusAfterProcess,
  stopReason,
  type CandidateRow,
  type GuardState,
} from "../../scripts/archive/lib/run-plan";

const row = (
  pointer: number,
  edition_date: string,
  status: CandidateRow["status"] = "pending",
  attempts = 0
): CandidateRow => ({ pointer, edition_date, status, attempts, local_dir: null });

describe("parseRunArgs", () => {
  it("reads count, target and decade, and defaults the cap to $0.75 per edition", () => {
    expect(
      parseRunArgs(["--count", "4", "--target", "local", "--decade", "1970s", "--yes"])
    ).toEqual({ count: 4, target: "local", decade: "1970s", maxUsd: 3 });
    expect(
      parseRunArgs(["--count", "2", "--target", "production", "--max-usd", "1.2", "--yes"])
    ).toEqual({ count: 2, target: "production", decade: null, maxUsd: 1.2 });
  });

  it.each([
    [["--target", "local", "--yes"], "--count"],
    [["--count", "51", "--target", "local", "--yes"], "--count"],
    [["--count", "0", "--target", "local", "--yes"], "--count"],
    [["--count", "2", "--yes"], "--target"],
    [["--count", "2", "--target", "prod", "--yes"], "--target"],
    [["--count", "2", "--target", "local"], "--yes"],
    [["--count", "2", "--target", "local", "--decade", "198", "--yes"], "--decade"],
    [["--count", "2", "--target", "local", "--max-usd", "-1", "--yes"], "--max-usd"],
  ])("refuses %j", (argv, flag) => {
    expect(() => parseRunArgs(argv)).toThrow(flag);
  });
});

describe("pickNext", () => {
  it("runs downloaded rows first, then the default decade order, oldest date first", () => {
    const rows = [
      row(1, "1975-01-10"),
      row(2, "1985-03-01"),
      row(3, "1981-09-01"),
      row(4, "1955-01-01", "downloaded"),
      row(5, "1995-01-01"),
      row(6, "1966-01-01"),
      row(7, "2003-01-01"),
      row(8, "1952-01-01"),
    ];
    expect(pickNext(rows, { count: 8, decade: null }).map((r) => r.pointer)).toEqual([
      4, 3, 2, 1, 5, 6, 7, 8,
    ]);
  });

  it("skips pre-1950 editions unless their decade is named", () => {
    const rows = [row(1, "1925-01-01"), row(2, "1985-01-01"), row(3, "1921-05-05")];
    expect(pickNext(rows, { count: 5, decade: null }).map((r) => r.pointer)).toEqual([2]);
    expect(pickNext(rows, { count: 5, decade: "1920s" }).map((r) => r.pointer)).toEqual([3, 1]);
  });

  it("retries failed rows after pending ones, and never a row with 3 attempts", () => {
    const rows = [
      row(1, "1980-01-01", "failed", 1),
      row(2, "1989-01-01"),
      row(3, "1980-02-01", "failed", 3),
      row(4, "1980-03-01", "needs_review"),
      row(5, "1980-04-01", "backed_up"),
    ];
    expect(pickNext(rows, { count: 5, decade: null }).map((r) => r.pointer)).toEqual([2, 1]);
  });

  it("takes at most count rows", () => {
    const rows = [row(1, "1980-01-01"), row(2, "1980-01-02"), row(3, "1980-01-03")];
    expect(pickNext(rows, { count: 2, decade: null })).toHaveLength(2);
  });
});

describe("statusAfterProcess", () => {
  it.each([
    [0, 1, "published", null],
    [20, 1, "needs_review", "failed publish checks; scans kept"],
    [50, 1, "needs_review", "published, seed failed: run --repair-seed"],
    [10, 1, "failed", "process-edition exited 10"],
    [30, 2, "failed", "process-edition exited 30"],
    [10, 3, "needs_review", "process-edition exited 10 (3 attempts)"],
  ])("exit %i on attempt %i → %s", (code, attempts, status, error) => {
    expect(statusAfterProcess(code, attempts)).toEqual({ status, error });
  });
});

describe("stopReason", () => {
  const ok: GuardState = {
    holdPresent: false,
    ownsLock: true,
    freeBytes: 50 * 1024 ** 3,
    spentUsd: 1,
    maxUsd: 3,
    consecutiveFailures: 2,
  };

  it("lets a healthy run continue", () => {
    expect(stopReason(ok)).toBeNull();
  });

  it.each([
    [{ holdPresent: true }, "ocr/.hold"],
    [{ ownsLock: false }, "lock"],
    [{ freeBytes: 9 * 1024 ** 3 }, "10 GB"],
    [{ spentUsd: 2.3 }, "$3.00 cap"],
    [{ consecutiveFailures: 3 }, "3 failures in a row"],
  ])("stops on %j", (change, reason) => {
    expect(stopReason({ ...ok, ...change })).toContain(reason);
  });
});

describe("failureCostSince", () => {
  it("sums this date's failed-call costs logged since the start, skipping junk", () => {
    const lines = [
      { timestamp: "2026-10-28T10:00:00+00:00", edition: "1983-09-22", estimated_cost_usd: 0.5 },
      { timestamp: "2026-10-28T12:00:01+00:00", edition: "1983-09-22", estimated_cost_usd: 0.02 },
      { timestamp: "2026-10-28T12:00:02+00:00", edition: "1984-01-01", estimated_cost_usd: 0.3 },
      { timestamp: "2026-10-28T12:00:03+00:00", edition: "1983-09-22", stage: "ocr" },
    ]
      .map((line) => JSON.stringify(line))
      .concat(["not json", ""])
      .join("\n");
    expect(failureCostSince(lines, "1983-09-22", "2026-10-28T12:00:00.000Z")).toBeCloseTo(0.02);
  });
});

describe("inboxFolderName", () => {
  it("starts with the date, which process-edition.sh reads from the name", () => {
    expect(inboxFolderName("1983-09-22", 1234)).toBe("1983-09-22 contentdm-1234");
  });
});

describe("assertLocalRunner", () => {
  it("refuses to keep run state anywhere but the local database", () => {
    expect(() => assertLocalRunner("postgresql://u:p@localhost:5432/transcript")).not.toThrow();
    expect(() =>
      assertLocalRunner("postgresql://u:p@ep-x-pooler.us-east-2.aws.neon.tech/neondb")
    ).toThrow("local");
  });
});
