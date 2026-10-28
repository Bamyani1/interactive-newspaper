import { describe, expect, it } from "vitest";
import { mastheadOf, planSync, type SyncInput } from "../../scripts/archive/lib/source-editions";

function input(overrides: Partial<SyncInput>): SyncInput {
  return {
    records: [],
    existing: new Map(),
    publishedDates: new Set(),
    indexedDates: new Set(),
    inboxByPointer: new Map(),
    inboxByDate: new Map(),
    ...overrides,
  };
}

const rec = (pointer: number, date: string, title = `The Transcript (Delaware, OH), ${date}`) => ({
  pointer,
  date,
  title,
});

describe("mastheadOf", () => {
  it.each([
    ["Western Collegian (Delaware, OH), 1867-10-01", "Western Collegian"],
    ["The Practical Student (Delaware, OH), 1890-10-02", "The Practical Student"],
    ["The College Transcript (Delaware, OH), 1901-01-10", "The College Transcript"],
    ["The Ohio Wesleyan Transcript (Delaware, OH), 1958-10-01", "The Ohio Wesleyan Transcript"],
    ["The Transcript (Delaware, OH), 1992-10-21", "The Transcript"],
  ])("%s → %s", (title, masthead) => {
    expect(mastheadOf(title)).toBe(masthead);
  });
});

describe("planSync", () => {
  it("files a new record by what already exists for its date", () => {
    const plan = planSync(
      input({
        records: [
          rec(1, "1983-04-21"),
          rec(2, "1983-04-28"),
          rec(3, "1983-09-22"),
          rec(4, "1984-01-01"),
        ],
        publishedDates: new Set(["1983-04-21", "1983-04-28"]),
        indexedDates: new Set(["1983-04-28"]),
        inboxByPointer: new Map([[3, "ocr/inbox/1983-09-22 The Transcript"]]),
      })
    );
    const byPointer = new Map(plan.inserts.map((row) => [row.pointer, row]));
    expect(byPointer.get(1)?.status).toBe("backed_up");
    expect(byPointer.get(2)?.status).toBe("indexed");
    expect(byPointer.get(3)).toMatchObject({
      status: "downloaded",
      local_dir: "ocr/inbox/1983-09-22 The Transcript",
    });
    expect(byPointer.get(4)).toMatchObject({
      status: "pending",
      edition_date: "1984-01-01",
      masthead: "The Transcript",
    });
  });

  it("matches an inbox folder by date when the manifest pointer is unknown", () => {
    const plan = planSync(
      input({
        records: [rec(5, "1985-02-01")],
        inboxByDate: new Map([["1985-02-01", "ocr/inbox/1985-02-01 x"]]),
      })
    );
    expect(plan.inserts[0]).toMatchObject({
      status: "downloaded",
      local_dir: "ocr/inbox/1985-02-01 x",
    });
  });

  it("sends both records of a shared date to review, since the site keys editions by date", () => {
    const plan = planSync(input({ records: [rec(10, "1992-10-21"), rec(11, "1992-10-21")] }));
    expect(plan.inserts.map((row) => row.status)).toEqual(["needs_review", "needs_review"]);
    expect(plan.inserts[0].last_error).toBe("same_date: 10,11");
  });

  it("never downgrades an existing row and promotes pending rows whose date got published", () => {
    const plan = planSync(
      input({
        records: [rec(20, "1970-01-01"), rec(21, "1970-02-01"), rec(22, "1970-03-01")],
        existing: new Map([
          [20, { status: "failed" as const }],
          [21, { status: "pending" as const }],
          [22, { status: "pending" as const }],
        ]),
        publishedDates: new Set(["1970-01-01", "1970-02-01"]),
      })
    );
    expect(plan.inserts).toEqual([]);
    expect(plan.promotions).toEqual([{ pointer: 21, status: "backed_up" }]);
  });
});
