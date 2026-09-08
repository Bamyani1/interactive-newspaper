/** @vitest-environment node */
/**
 * The DB timeout race lives in its own module so callers that must not
 * pull in `db.ts` (which builds a Neon client at module load) can still
 * bound a query: conversation-store, cost-tracker, rate-limit and the
 * ask route all need the race without the driver.
 *
 * `db.ts` re-exports both symbols, so every existing `instanceof` check
 * and test mock keeps working — that identity is asserted below.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("@neondatabase/serverless", () => ({
  neon: vi.fn(() => {
    const fn = vi.fn() as ReturnType<typeof vi.fn> & {
      transaction: ReturnType<typeof vi.fn>;
      query: ReturnType<typeof vi.fn>;
    };
    fn.transaction = vi.fn();
    fn.query = vi.fn();
    return fn;
  }),
}));

import { DbTimeoutError, runWithDbTimeout } from "@/src/lib/db-timeout";

describe("DbTimeoutError", () => {
  it("carries the operation name and budget in the message and on the instance", () => {
    const error = new DbTimeoutError("someOp", 1234);
    expect(error.name).toBe("DbTimeoutError");
    expect(error.op).toBe("someOp");
    expect(error.timeoutMs).toBe(1234);
    expect(error.message).toBe("Database operation timed out: someOp after 1234ms");
    expect(error).toBeInstanceOf(Error);
  });
});

describe("runWithDbTimeout", () => {
  it("resolves with the operation's value when it finishes inside the budget", async () => {
    const value = await runWithDbTimeout("fast", async () => "ok", 1_000);
    expect(value).toBe("ok");
  });

  it("rejects with DbTimeoutError once the budget elapses", async () => {
    const pending = runWithDbTimeout("slow", () => new Promise<string>(() => {}), 20);
    await expect(pending).rejects.toBeInstanceOf(DbTimeoutError);
    await expect(pending).rejects.toMatchObject({ op: "slow", timeoutMs: 20 });
  });

  it("aborts the signal it hands the operation so Neon cancels its fetch", async () => {
    let seen: AbortSignal | undefined;
    await expect(
      runWithDbTimeout(
        "aborts",
        (signal) => {
          seen = signal;
          return new Promise<string>(() => {});
        },
        20
      )
    ).rejects.toBeInstanceOf(DbTimeoutError);
    expect(seen?.aborted).toBe(true);
  });

  it("fails immediately when the caller's signal is already aborted", async () => {
    const outer = AbortSignal.abort();
    const operation = vi.fn(async () => "never");
    await expect(runWithDbTimeout("pre-aborted", operation, 1_000, outer)).rejects.toBeInstanceOf(
      DbTimeoutError
    );
    expect(operation).not.toHaveBeenCalled();
  });

  it("propagates the caller's abort as a DbTimeoutError", async () => {
    const outer = new AbortController();
    const pending = runWithDbTimeout(
      "outer-abort",
      () => new Promise<string>(() => {}),
      10_000,
      outer.signal
    );
    outer.abort();
    await expect(pending).rejects.toBeInstanceOf(DbTimeoutError);
  });

  it("passes through a non-timeout failure unchanged", async () => {
    const boom = new Error("syntax error at or near");
    await expect(
      runWithDbTimeout(
        "broken",
        async () => {
          throw boom;
        },
        1_000
      )
    ).rejects.toBe(boom);
  });
});

describe("db.ts re-exports", () => {
  it("re-exports the same DbTimeoutError class so instanceof stays sound", async () => {
    const db = await import("@/src/lib/db");
    expect(db.DbTimeoutError).toBe(DbTimeoutError);
    expect(new DbTimeoutError("op", 1)).toBeInstanceOf(db.DbTimeoutError);
  });

  it("re-exports runWithDbTimeout", async () => {
    const db = await import("@/src/lib/db");
    expect(db.runWithDbTimeout).toBe(runWithDbTimeout);
  });
});
