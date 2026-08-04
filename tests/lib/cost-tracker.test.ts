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
    computeEmbeddingCostUsd,
    embeddingTokenCount,
    checkDailyBudget,
    recordUsage,
    DailyBudgetExceededError,
    _setDailyBudgetForTests,
    _getDailyBudgetForTests,
    _getEvaluationSpendForTests,
    _getEvaluationReservedForTests,
    _resetEvaluationSpendForTests,
    _getOutageSpendForTests,
    _resetOutageSpendForTests,
    executeTrackedGenerationCall,
    releaseEvaluationGoogleCall,
    reserveEvaluationGoogleCall,
    settleEvaluationGoogleCall,
} from "@/src/lib/cost-tracker";

const ORIGINAL_BUDGET = 0.5;

describe("computeCostUsd", () => {
    it("returns 0 when usage is undefined", () => {
        expect(computeCostUsd("gemini-3.5-flash-lite", undefined)).toBe(0);
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
        // 1M input at $0.30/M + 1M output/reasoning at $2.50/M.
        const cost = computeCostUsd("gemini-3.5-flash-lite", {
            promptTokenCount: 1_000_000,
            candidatesTokenCount: 1_000_000,
        });
        expect(cost).toBeCloseTo(2.8, 6);
    });

    it("handles embedding model with zero output price", () => {
        const cost = computeCostUsd("gemini-embedding-2", {
            promptTokenCount: 1_000_000,
            candidatesTokenCount: 0,
        });
        expect(cost).toBeCloseTo(0.2, 6);
    });

    it("treats missing token counts as 0", () => {
        expect(
            computeCostUsd("gemini-3.5-flash-lite", {
                promptTokenCount: undefined,
                candidatesTokenCount: undefined,
            }),
        ).toBe(0);
    });

    it("bills tool-use prompt tokens as input and thought tokens as output", () => {
        expect(
            computeCostUsd("gemini-3.5-flash-lite", {
                promptTokenCount: 1_000_000,
                toolUsePromptTokenCount: 1_000_000,
                candidatesTokenCount: 1_000_000,
                thoughtsTokenCount: 1_000_000,
            }),
        ).toBeCloseTo(5.6, 6);
    });
});

describe("embedding cost", () => {
    it("uses exact Vertex token statistics and the per-image charge", () => {
        const response = {
            embeddings: [
                { values: [], statistics: { tokenCount: 600 } },
                { values: [], statistics: { tokenCount: 400 } },
            ],
            metadata: { billableCharacterCount: 999_999 },
        };
        expect(embeddingTokenCount(response)).toBe(1000);
        expect(
            computeEmbeddingCostUsd("gemini-embedding-2", response, {
                imageCount: 2,
            }),
        ).toBeCloseTo(0.00044, 8);
    });

    it("falls back to billable characters when token statistics are absent", () => {
        expect(
            embeddingTokenCount({
                embeddings: [{ values: [] }],
                metadata: { billableCharacterCount: 400 },
            }),
        ).toBe(100);
    });
});

describe("checkDailyBudget", () => {
    beforeEach(() => {
        vi.unstubAllEnvs();
        _resetEvaluationSpendForTests();
        _resetOutageSpendForTests();
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
        vi.unstubAllEnvs();
        _resetEvaluationSpendForTests();
        _resetOutageSpendForTests();
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
            "gemini-3.5-flash-lite",
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
        expect(substitutions).toContain(2.8); // cost in USD
        // day string is YYYY-MM-DD
        expect(substitutions.some((v: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(v)))).toBe(true);
    });

    it("does not throw when the DB write fails", async () => {
        sqlMock.mockRejectedValueOnce(new Error("neon write failed"));
        await expect(
            recordUsage(
                "gemini-3.5-flash-lite",
                { promptTokenCount: 100, candidatesTokenCount: 50 },
                { op: "test" },
            ),
        ).resolves.toBeUndefined();
    });

    it("keeps evaluation spend out of the online Neon ledger", async () => {
        vi.stubEnv("RAG_EVALUATION_MODE", "1");
        vi.stubEnv("RAG_EVALUATION_RUN_ID", "cost-test");
        vi.stubEnv("RAG_CORPUS_VERSION", "legacy-test");
        vi.stubEnv("RAG_EVALUATION_SPEND_CAP_USD", "5");

        await recordUsage(
            "gemini-3.5-flash-lite",
            { promptTokenCount: 1_000_000, candidatesTokenCount: 1_000_000 },
            { op: "evaluation.test" },
        );

        expect(_getEvaluationSpendForTests()).toBeCloseTo(2.8, 6);
        expect(sqlMock).not.toHaveBeenCalled();
    });

    it("blocks the next request after the evaluation run reaches its cap", async () => {
        vi.stubEnv("RAG_EVALUATION_MODE", "1");
        vi.stubEnv("RAG_EVALUATION_RUN_ID", "cost-cap-test");
        vi.stubEnv("RAG_CORPUS_VERSION", "legacy-test");
        vi.stubEnv("RAG_EVALUATION_SPEND_CAP_USD", "5");
        const usage = {
            promptTokenCount: 1_000_000,
            candidatesTokenCount: 1_000_000,
        };
        await recordUsage("gemini-3.5-flash-lite", usage, { op: "evaluation.one" });
        await recordUsage("gemini-3.5-flash-lite", usage, { op: "evaluation.two" });

        try {
            await checkDailyBudget();
            throw new Error("expected evaluation budget rejection");
        } catch (error) {
            expect(error).toBeInstanceOf(DailyBudgetExceededError);
            expect((error as DailyBudgetExceededError).scope).toBe("evaluation_run");
        }
        expect(sqlMock).not.toHaveBeenCalled();
    });
});

describe("bounded fail-open during a DB outage", () => {
    const usage = { promptTokenCount: 1_000_000, candidatesTokenCount: 1_000_000 }; // $2.80
    beforeEach(() => {
        vi.unstubAllEnvs();
        _resetEvaluationSpendForTests();
        _resetOutageSpendForTests();
        sqlMock.mockReset();
        _setDailyBudgetForTests(ORIGINAL_BUDGET);
    });

    it("fails open (still allows) while blind outage spend is under the ceiling", async () => {
        // A failed write accrues a tiny amount, well under $0.50.
        sqlMock.mockRejectedValueOnce(new Error("neon write failed"));
        await recordUsage(
            "gemini-3.5-flash-lite",
            { promptTokenCount: 100, candidatesTokenCount: 50 },
            { op: "outage.small" },
        );
        expect(_getOutageSpendForTests()).toBeCloseTo(0.000155, 8);
        // The budget read also fails, but under the ceiling we don't block.
        sqlMock.mockRejectedValueOnce(new Error("neon unreachable"));
        await expect(checkDailyBudget()).resolves.toBeUndefined();
    });

    it("refuses (429) once blind outage spend crosses the ceiling", async () => {
        sqlMock.mockRejectedValueOnce(new Error("neon write failed"));
        await recordUsage("gemini-3.5-flash-lite", usage, { op: "outage.large" });
        expect(_getOutageSpendForTests()).toBeCloseTo(2.8, 6);
        sqlMock.mockRejectedValueOnce(new Error("neon unreachable"));
        try {
            await checkDailyBudget();
            throw new Error("expected fail-open ceiling rejection");
        } catch (err) {
            expect(err).toBeInstanceOf(DailyBudgetExceededError);
            expect((err as DailyBudgetExceededError).budgetUsd).toBe(0.5);
            expect((err as DailyBudgetExceededError).spentUsd).toBeCloseTo(2.8, 6);
        }
    });

    it("resets the accumulator once the DB is reachable again", async () => {
        sqlMock.mockRejectedValueOnce(new Error("neon write failed"));
        await recordUsage("gemini-3.5-flash-lite", usage, { op: "outage.large" });
        expect(_getOutageSpendForTests()).toBeCloseTo(2.8, 6);
        // A successful budget read means Neon recovered; the accumulator clears
        // and the request is allowed again.
        sqlMock.mockResolvedValueOnce([{ spent_usd: "0.000000" }]);
        await expect(checkDailyBudget()).resolves.toBeUndefined();
        expect(_getOutageSpendForTests()).toBe(0);
    });
});

describe("hard evaluation reservations", () => {
    beforeEach(() => {
        vi.unstubAllEnvs();
        _resetEvaluationSpendForTests();
        sqlMock.mockReset();
        vi.stubEnv("RAG_EVALUATION_MODE", "1");
        vi.stubEnv("RAG_EVALUATION_RUN_ID", "reservation-test");
        vi.stubEnv("RAG_CORPUS_VERSION", "legacy-test");
        vi.stubEnv("RAG_EVALUATION_SPEND_CAP_USD", "1");
    });

    it("rejects parallel calls before their conservative maxima can cross the cap", () => {
        const first = reserveEvaluationGoogleCall({
            model: "gemini-3.5-flash-lite",
            op: "first",
            maxOutputTokens: 8192,
        });
        expect(first).not.toBeNull();
        expect(_getEvaluationReservedForTests()).toBeGreaterThan(0.6);
        expect(() =>
            reserveEvaluationGoogleCall({
                model: "gemini-3.5-flash-lite",
                op: "second",
                maxOutputTokens: 8192,
            }),
        ).toThrow(DailyBudgetExceededError);
        releaseEvaluationGoogleCall(first);
        expect(_getEvaluationReservedForTests()).toBe(0);
    });

    it("atomically replaces a reservation with actual usage", () => {
        const reservation = reserveEvaluationGoogleCall({
            model: "gemini-3.5-flash-lite",
            op: "settle",
            maxOutputTokens: 8192,
        });
        settleEvaluationGoogleCall(reservation, 0.0125);
        expect(_getEvaluationReservedForTests()).toBe(0);
        expect(_getEvaluationSpendForTests()).toBeCloseTo(0.0125, 8);
    });

    it("tracked generation records evaluation cost exactly once", async () => {
        const response = await executeTrackedGenerationCall({
            model: "gemini-3.5-flash-lite",
            op: "tracked",
            maxOutputTokens: 350,
            call: async () => ({
                usageMetadata: {
                    promptTokenCount: 1000,
                    candidatesTokenCount: 100,
                },
            }),
        });
        expect(response.usageMetadata.promptTokenCount).toBe(1000);
        expect(_getEvaluationReservedForTests()).toBe(0);
        expect(_getEvaluationSpendForTests()).toBeCloseTo(0.00055, 8);
        expect(sqlMock).not.toHaveBeenCalled();
    });

    it("releases the reservation when Google rejects the call", async () => {
        await expect(
            executeTrackedGenerationCall({
                model: "gemini-3.5-flash-lite",
                op: "failure",
                maxOutputTokens: 350,
                call: async () => {
                    throw new Error("google unavailable");
                },
            }),
        ).rejects.toThrow("google unavailable");
        expect(_getEvaluationReservedForTests()).toBe(0);
        expect(_getEvaluationSpendForTests()).toBe(0);
    });
});

describe("test helpers", () => {
    afterEach(() => _setDailyBudgetForTests(ORIGINAL_BUDGET));

    it("_setDailyBudgetForTests / _getDailyBudgetForTests round-trip", () => {
        _setDailyBudgetForTests(1.23);
        expect(_getDailyBudgetForTests()).toBe(1.23);
    });
});
