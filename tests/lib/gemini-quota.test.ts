import { describe, expect, it, vi } from "vitest";

import {
  isQuotaError,
  isQuotaFailure,
  kindForQuota,
  LIVE_QUOTA_RETRY_DELAYS_MS,
  retryAfterSecFromQuotaError,
  retryOnQuota,
} from "@/src/lib/gemini-quota";

const quotaError = () => Object.assign(new Error("rate limit"), { code: 429 });

describe("isQuotaFailure", () => {
  it("recognises a raw 429 and an already-typed QuotaExhaustedError", () => {
    expect(isQuotaFailure(quotaError())).toBe(true);
    const typed = new Error("Gemini API quota exhausted (embedQuery)");
    typed.name = "QuotaExhaustedError";
    expect(isQuotaFailure(typed)).toBe(true);
    expect(isQuotaFailure(new Error("server exploded"))).toBe(false);
  });
});

describe("retryOnQuota", () => {
  it("keeps the live delays short enough for a request deadline", () => {
    expect(LIVE_QUOTA_RETRY_DELAYS_MS).toEqual([1_000, 2_000]);
  });

  it("retries a quota failure on the supplied delays and returns the recovery", async () => {
    vi.useFakeTimers();
    try {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(quotaError())
        .mockRejectedValueOnce(quotaError())
        .mockResolvedValueOnce("ok");

      const promise = retryOnQuota("rerank", fn, { delaysMs: [1_000, 2_000] });
      promise.catch(() => {});
      await vi.advanceTimersByTimeAsync(3_000);

      await expect(promise).resolves.toBe("ok");
      expect(fn).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("throws the last quota failure once the delays are spent", async () => {
    vi.useFakeTimers();
    try {
      const err = quotaError();
      const fn = vi.fn().mockRejectedValue(err);

      const promise = retryOnQuota("rerank", fn, { delaysMs: [1_000] });
      promise.catch(() => {});
      await vi.advanceTimersByTimeAsync(1_000);

      await expect(promise).rejects.toBe(err);
      expect(fn).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not retry a non-quota error", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("server exploded"));
    await expect(retryOnQuota("rerank", fn, { delaysMs: [1_000] })).rejects.toThrow(
      "server exploded"
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("abandons the backoff and rethrows the original error when the deadline aborts", async () => {
    vi.useFakeTimers();
    try {
      const err = quotaError();
      const fn = vi.fn().mockRejectedValue(err);
      const controller = new AbortController();

      const promise = retryOnQuota("rerank", fn, {
        delaysMs: [30_000],
        signal: controller.signal,
      });
      promise.catch(() => {});
      await vi.advanceTimersByTimeAsync(10);
      controller.abort();

      await expect(promise).rejects.toBe(err);
      // The sleep resolved on abort instead of burning the remaining 30s,
      // and no further attempt was dispatched.
      expect(fn).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never sleeps when the signal is already aborted", async () => {
    const err = quotaError();
    const fn = vi.fn().mockRejectedValue(err);
    const controller = new AbortController();
    controller.abort();

    await expect(
      retryOnQuota("rerank", fn, { delaysMs: [30_000], signal: controller.signal })
    ).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("quota classification helpers", () => {
  it("reads a retryDelay out of the error and classifies the wait", () => {
    const err = new Error('{"error":{"code":429,"details":[{"retryDelay":"23s"}]}}');
    expect(isQuotaError(err)).toBe(true);
    expect(retryAfterSecFromQuotaError(err)).toBe(23);
    expect(kindForQuota(23)).toBe("rate_limit");
    expect(kindForQuota(3600)).toBe("budget");
  });
});
