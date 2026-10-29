/** @vitest-environment node */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ensureOpsSchema } from "../../scripts/archive/lib/ops-schema";
import { sqlStore } from "../../scripts/archive/run";
import { createTestDb, type TestDb } from "../db/helpers/pglite";

describe("archive:run store", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
    await ensureOpsSchema(db.executor);
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    await db.executor.query({ text: "DELETE FROM ops.source_editions" });
    await db.executor.query({ text: "DELETE FROM ops.run_lock" });
  });

  const insert = (pointer: number, date: string, status: string) =>
    db.executor.query({
      text: `INSERT INTO ops.source_editions (pointer, edition_date, title, masthead, status)
             VALUES ($1, $2, 't', 'm', $3)`,
      params: [pointer, date, status],
    });

  it("offers rows a dead run left published, alongside the runnable ones", async () => {
    await insert(1, "1980-01-01", "pending");
    await insert(2, "1980-02-01", "published");
    await insert(3, "1980-03-01", "backed_up");
    const rows = await sqlStore(db.executor).candidates();
    expect(rows.map((row) => [row.pointer, row.status]).sort()).toEqual([
      [1, "pending"],
      [2, "published"],
    ]);
  });

  it("takes a free lock, refuses a live holder's, and takes over a dead holder's", async () => {
    const store = sqlStore(db.executor);
    expect(await store.acquireLock("run-a", 100, () => false)).toBe(true);
    expect(await store.acquireLock("run-b", 200, (pid) => pid === 100)).toBe(false);
    expect(await store.acquireLock("run-c", 300, () => false)).toBe(true);
    expect(await store.holdsLock("run-c")).toBe(true);
  });

  it("does not steal a lock another run took after this one read it", async () => {
    const store = sqlStore(db.executor);
    await store.acquireLock("run-dead", 100, () => false);
    // While run-b checks whether pid 100 is alive, run-c takes the dead lock.
    const racing = await store.acquireLock("run-b", 200, (pid) => {
      if (pid === 100) {
        void db.executor.query({
          text: "UPDATE ops.run_lock SET run_id = 'run-c', pid = 300 WHERE id = 1",
        });
      }
      return false;
    });
    expect(racing).toBe(false);
    expect(await store.holdsLock("run-c")).toBe(true);
  });

  it("does not overwrite a lock another run inserted after this one saw it free", async () => {
    const store = sqlStore(db.executor);
    let first = true;
    const executor = {
      query: async (statement: { text: string; params?: unknown[] }) => {
        // Another run inserts between this run's read and its write.
        if (first && /INSERT INTO ops.run_lock/.test(statement.text)) {
          first = false;
          await db.executor.query({
            text: "INSERT INTO ops.run_lock (id, run_id, pid) VALUES (1, 'run-c', 300)",
          });
        }
        return db.executor.query(statement);
      },
      transactionBatch: db.executor.transactionBatch,
    };
    expect(await sqlStore(executor).acquireLock("run-b", 200, () => false)).toBe(false);
    expect(await store.holdsLock("run-c")).toBe(true);
  });
});
