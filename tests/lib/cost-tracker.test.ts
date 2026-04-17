/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the Neon SQL tag. The module imports `neon` from
// @neondatabase/serverless at load time; we return a fake that
// captures each call as an object and returns mockable rows.
const { sqlMock } = vi.hoisted(() => ({
    sqlMock: vi.fn(),
}));

vi.mock("@neondatabase/serverless", () => ({
    neon: () => sqlMock,
}));

// The module's lazy `getSql()` only initializes if DATABASE_URL is set.
// Give it any non-empty value so the mocked neon() is used.
process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgres://fake/test";

// Import AFTER the mock is declared so the module sees our fake.
import {
    computeCostUsd,
    checkDailyBudget,
    recordUsage,
    DailyBudgetExceededError,
    _setDailyBudgetForTests,
    _getDailyBudgetForTests,
} from "@/src/lib/cost-tracker";

const ORIGINAL_BUDGET = 0.5;

describe("computeCostUsd", () => {
    it("returns 0 when usage is undefined", () => {
        expect(computeCostUsd("gemini-3-flash-preview", undefined)).toBe(0);
    });

    it("returns 0 for an unknown model", () => {
        expect(
            computeCostUsd("some-other-model", {
                promptTokenCount: 1_000,
                candidatesTokenCount: 500,
            }),
        ).toBe(0);
    });

    it("multiplies tokens by the model's input+output rate", () => {
        // 1M input tokens at $0.10/M + 1M output at $0.40/M = $0.50
        const cost = computeCostUsd("gemini-3-flash-preview", {
            promptTokenCount: 1_000_000,
            candidatesTokenCount: 1_000_000,
        });
        expect(cost).toBeCloseTo(0.5, 6);
    });

    it("handles embedding model with zero output price", () => {
        // 1M input tokens at $0.025/M = $0.025
        const cost = computeCostUsd("gemini-embedding-2-preview", {
            promptTokenCount: 1_000_000,
            candidatesTokenCount: 0,
        });
        expect(cost).toBeCloseTo(0.025, 6);
    });

    it("treats missing token counts as 0", () => {
        expect(
            computeCostUsd("gemini-3-flash-preview", {
                promptTokenCount: undefined,
                candidatesTokenCount: undefined,
            }),
        ).toBe(0);
    });
});

describe("checkDailyBudget", () => {
    beforeEach(() => {
        sqlMock.mockReset();
        _setDailyBudgetForTests(ORIGINAL_BUDGET);
    });

    it("passes silently when spent under the budget", async () => {
        sqlMock.mockResolvedValueOnce([{ spent_usd: "0.100000" }]);
        await expect(checkDailyBudget()).resolves.toBeUndefined();
    });

    it("passes silently when no row exists for today", async () => {
        sqlMock.mockResolvedValueOnce([]);
        await expect(checkDailyBudget()).resolves.toBeUndefined();
    });

    it("throws DailyBudgetExceededError at or over the budget", async () => {
        sqlMock.mockResolvedValueOnce([{ spent_usd: "0.500000" }]);
        await expect(checkDailyBudget()).rejects.toBeInstanceOf(
            DailyBudgetExceededError,
        );
    });

    it("throws with spent + budget attached to the error", async () => {
        _setDailyBudgetForTests(1.0);
        sqlMock.mockResolvedValueOnce([{ spent_usd: "1.234567" }]);
        try {
            await checkDailyBudget();
            throw new Error("expected throw");
        } catch (err) {
            expect(err).toBeInstanceOf(DailyBudgetExceededError);
            if (err instanceof DailyBudgetExceededError) {
                expect(err.spentUsd).toBeCloseTo(1.234567, 5);
                expect(err.budgetUsd).toBe(1.0);
            }
        }
    });

    it("swallows DB errors (does not throw on unreachable Neon)", async () => {
        sqlMock.mockRejectedValueOnce(new Error("neon unreachable"));
        await expect(checkDailyBudget()).resolves.toBeUndefined();
    });
});

describe("recordUsage", () => {
    beforeEach(() => {
        sqlMock.mockReset();
        _setDailyBudgetForTests(ORIGINAL_BUDGET);
    });

    it("skips the INSERT when computed cost is 0", async () => {
        await recordUsage("unknown-model", { promptTokenCount: 100 }, {
            op: "test",
        });
        expect(sqlMock).not.toHaveBeenCalled();
    });

    it("emits an INSERT ... ON CONFLICT with the day + cost", async () => {
        sqlMock.mockResolvedValueOnce(undefined);
        await recordUsage(
            "gemini-3-flash-preview",
            { promptTokenCount: 1_000_000, candidatesTokenCount: 1_000_000 },
            { op: "test.route", requestId: "r1" },
        );
        expect(sqlMock).toHaveBeenCalledTimes(1);
        // The first mock call is the tagged-template form; vitest captures
        // the template strings array + substitution values. We just assert
        // that a day string was interpolated and the cost number was
        // passed — the exact SQL text is an implementation detail.
        const call = sqlMock.mock.calls[0];
        const substitutions = call.slice(1);
        expect(substitutions).toContain(0.5); // cost in USD
        // day string is YYYY-MM-DD
        expect(substitutions.some((v: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(v)))).toBe(true);
    });

    it("does not throw when the DB write fails", async () => {
        sqlMock.mockRejectedValueOnce(new Error("neon write failed"));
        await expect(
            recordUsage(
                "gemini-3-flash-preview",
                { promptTokenCount: 100, candidatesTokenCount: 50 },
                { op: "test" },
            ),
        ).resolves.toBeUndefined();
    });
});

describe("test helpers", () => {
    afterEach(() => _setDailyBudgetForTests(ORIGINAL_BUDGET));

    it("_setDailyBudgetForTests / _getDailyBudgetForTests round-trip", () => {
        _setDailyBudgetForTests(1.23);
        expect(_getDailyBudgetForTests()).toBe(1.23);
    });
});
