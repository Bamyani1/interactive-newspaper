// Pure rules for ops.source_editions: one row per CONTENTdm edition record.

export const SOURCE_STATUSES = [
  "pending",
  "downloaded",
  "published",
  "backed_up",
  "indexed",
  "needs_review",
  "failed",
] as const;
export type SourceStatus = (typeof SOURCE_STATUSES)[number];

export interface SourceRecord {
  pointer: number | string;
  date?: string;
  title?: string;
}

export interface SourceEditionInsert {
  pointer: number;
  edition_date: string;
  title: string;
  masthead: string;
  status: SourceStatus;
  local_dir: string | null;
  last_error: string | null;
}

export interface SyncInput {
  records: SourceRecord[];
  existing: Map<number, { status: SourceStatus }>;
  /** Dates in the editions table (the local copy of production). */
  publishedDates: Set<string>;
  /** Dates with chunks in the active index build. */
  indexedDates: Set<string>;
  inboxByPointer: Map<number, string>;
  inboxByDate: Map<string, string>;
}

export interface SyncPlan {
  inserts: SourceEditionInsert[];
  promotions: { pointer: number; status: SourceStatus }[];
}

/** "The Transcript (Delaware, OH), 1992-10-21" → "The Transcript". */
export function mastheadOf(title: string): string {
  return title
    .replace(/\s*\(.*$/, "")
    .replace(/,\s*\d{4}-\d{2}-\d{2}.*$/, "")
    .trim();
}

function doneStatus(date: string, input: SyncInput): SourceStatus | null {
  if (input.indexedDates.has(date)) return "indexed";
  if (input.publishedDates.has(date)) return "backed_up";
  return null;
}

export function planSync(input: SyncInput): SyncPlan {
  const pointersByDate = new Map<string, number[]>();
  for (const record of input.records) {
    if (!record.date) continue;
    const list = pointersByDate.get(record.date) ?? [];
    list.push(Number(record.pointer));
    pointersByDate.set(record.date, list);
  }

  const plan: SyncPlan = { inserts: [], promotions: [] };
  for (const record of input.records) {
    const pointer = Number(record.pointer);
    const date = record.date;
    if (!date) continue;
    const existing = input.existing.get(pointer);
    if (existing) {
      // Only rows no run has touched yet follow a publish done elsewhere.
      const done = doneStatus(date, input);
      if (done && (existing.status === "pending" || existing.status === "downloaded")) {
        plan.promotions.push({ pointer, status: done });
      }
      continue;
    }

    const title = record.title ?? "";
    const row: SourceEditionInsert = {
      pointer,
      edition_date: date,
      title,
      masthead: mastheadOf(title),
      status: "pending",
      local_dir: null,
      last_error: null,
    };
    const shared = pointersByDate.get(date) ?? [];
    if (shared.length > 1) {
      row.status = "needs_review";
      row.last_error = `same_date: ${[...shared].sort((a, b) => a - b).join(",")}`;
    } else {
      const done = doneStatus(date, input);
      const inbox = input.inboxByPointer.get(pointer) ?? input.inboxByDate.get(date);
      if (done) row.status = done;
      else if (inbox) {
        row.status = "downloaded";
        row.local_dir = inbox;
      }
    }
    plan.inserts.push(row);
  }
  return plan;
}
