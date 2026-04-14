/**
 * Unit tests for the KV client wrapper.
 *
 * The wrapper is designed to be a graceful fallback surface: missing
 * env vars → all ops no-op, SDK throws → logged + null/false returned,
 * env present → SDK called with correct args. These tests cover all
 * three states without contacting real Upstash.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockGet, mockSet, mockDel } = vi.hoisted(() => ({
    mockGet: vi.fn() as ReturnType<typeof vi.fn>,
    mockSet: vi.fn() as ReturnType<typeof vi.fn>,
    mockDel: vi.fn() as ReturnType<typeof vi.fn>,
}));

vi.mock("@upstash/redis", () => ({
    Redis: vi.fn(() => ({
        get: mockGet,
        set: mockSet,
        del: mockDel,
    })),
}));

afterEach(() => {
    vi.restoreAllMocks();
    mockGet.mockReset();
    mockSet.mockReset();
    mockDel.mockReset();
});

describe("kv-client — env vars absent", () => {
    beforeEach(async () => {
        delete process.env.UPSTASH_REDIS_REST_URL;
        delete process.env.UPSTASH_REDIS_REST_TOKEN;
        const { _resetKvForTests } = await import("../../src/lib/kv-client");
        _resetKvForTests();
    });

    it("isKvAvailable() returns false", async () => {
        const { isKvAvailable } = await import("../../src/lib/kv-client");
        expect(isKvAvailable()).toBe(false);
    });

    it("kvGet returns null without calling SDK", async () => {
        const { kvGet } = await import("../../src/lib/kv-client");
        const result = await kvGet<string>("any-key");
        expect(result).toBeNull();
        expect(mockGet).not.toHaveBeenCalled();
    });

    it("kvSet returns false without calling SDK", async () => {
        const { kvSet } = await import("../../src/lib/kv-client");
        const result = await kvSet("any-key", { foo: "bar" }, 30);
        expect(result).toBe(false);
        expect(mockSet).not.toHaveBeenCalled();
    });

    it("kvDel returns false without calling SDK", async () => {
        const { kvDel } = await import("../../src/lib/kv-client");
        const result = await kvDel("any-key");
        expect(result).toBe(false);
        expect(mockDel).not.toHaveBeenCalled();
    });
});

describe("kv-client — env vars present", () => {
    beforeEach(async () => {
        process.env.UPSTASH_REDIS_REST_URL = "https://fake.upstash.io";
        process.env.UPSTASH_REDIS_REST_TOKEN = "fake-token";
        const { _resetKvForTests } = await import("../../src/lib/kv-client");
        _resetKvForTests();
    });

    it("isKvAvailable() returns true", async () => {
        const { isKvAvailable } = await import("../../src/lib/kv-client");
        expect(isKvAvailable()).toBe(true);
    });

    it("kvGet proxies to Redis.get and unwraps undefined → null", async () => {
        mockGet.mockResolvedValueOnce({ hello: "world" });
        const { kvGet } = await import("../../src/lib/kv-client");
        const result = await kvGet<{ hello: string }>("my-key");
        expect(result).toEqual({ hello: "world" });
        expect(mockGet).toHaveBeenCalledWith("my-key");
    });

    it("kvGet returns null when Redis returns undefined", async () => {
        mockGet.mockResolvedValueOnce(undefined);
        const { kvGet } = await import("../../src/lib/kv-client");
        const result = await kvGet<string>("missing");
        expect(result).toBeNull();
    });

    it("kvSet calls Redis.set with ex TTL option", async () => {
        mockSet.mockResolvedValueOnce("OK");
        const { kvSet } = await import("../../src/lib/kv-client");
        const result = await kvSet("my-key", { a: 1 }, 60);
        expect(result).toBe(true);
        expect(mockSet).toHaveBeenCalledWith("my-key", { a: 1 }, { ex: 60 });
    });

    it("kvDel proxies to Redis.del", async () => {
        mockDel.mockResolvedValueOnce(1);
        const { kvDel } = await import("../../src/lib/kv-client");
        const result = await kvDel("my-key");
        expect(result).toBe(true);
        expect(mockDel).toHaveBeenCalledWith("my-key");
    });
});

describe("kv-client — SDK errors", () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(async () => {
        process.env.UPSTASH_REDIS_REST_URL = "https://fake.upstash.io";
        process.env.UPSTASH_REDIS_REST_TOKEN = "fake-token";
        warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        const { _resetKvForTests } = await import("../../src/lib/kv-client");
        _resetKvForTests();
    });

    it("kvGet returns null and logs warn on throw", async () => {
        mockGet.mockRejectedValueOnce(new Error("network"));
        const { kvGet } = await import("../../src/lib/kv-client");
        const result = await kvGet<string>("any");
        expect(result).toBeNull();
        expect(warnSpy).toHaveBeenCalledTimes(1);
        const logged = JSON.parse(warnSpy.mock.calls[0][0] as string);
        expect(logged.stage).toBe("kv-fallback");
        expect(logged.op).toBe("get");
        expect(logged.key).toBe("any");
    });

    it("kvSet returns false and logs warn on throw", async () => {
        mockSet.mockRejectedValueOnce(new Error("timeout"));
        const { kvSet } = await import("../../src/lib/kv-client");
        const result = await kvSet("any", "value", 10);
        expect(result).toBe(false);
        expect(warnSpy).toHaveBeenCalledTimes(1);
        const logged = JSON.parse(warnSpy.mock.calls[0][0] as string);
        expect(logged.op).toBe("set");
    });

    it("kvDel returns false and logs warn on throw", async () => {
        mockDel.mockRejectedValueOnce(new Error("oops"));
        const { kvDel } = await import("../../src/lib/kv-client");
        const result = await kvDel("any");
        expect(result).toBe(false);
        expect(warnSpy).toHaveBeenCalledTimes(1);
        const logged = JSON.parse(warnSpy.mock.calls[0][0] as string);
        expect(logged.op).toBe("del");
    });
});
