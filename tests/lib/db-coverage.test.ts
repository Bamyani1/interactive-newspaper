/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSql } = vi.hoisted(() => {
    const fn = vi.fn() as ReturnType<typeof vi.fn> & {
        query: ReturnType<typeof vi.fn>;
        transaction: ReturnType<typeof vi.fn>;
    };
    fn.query = vi.fn();
    fn.transaction = vi.fn();
    return { mockSql: fn };
});

vi.mock("@neondatabase/serverless", () => ({
    neon: vi.fn(() => mockSql),
}));

import {
    DbTimeoutError,
    queryArchiveCoverage,
    _setRagIndexBuildReadyForTests,
    _setRagV2TablesAvailableForTests,
} from "@/src/lib/db";

describe("queryArchiveCoverage", () => {
    beforeEach(() => {
        vi.unstubAllEnvs();
        mockSql.mockReset();
        mockSql.query.mockReset();
        mockSql.transaction.mockReset();
        _setRagV2TablesAvailableForTests(false);
        _setRagIndexBuildReadyForTests(null);
        vi.stubEnv("RAG_RETRIEVAL_MODE", "legacy");
    });

    it("returns deterministic legacy edition and searchable-article scope", async () => {
        mockSql.query.mockResolvedValueOnce([
            {
                edition_count: 42,
                article_count: 1234,
                earliest_edition_date: "1960-01-07",
                latest_edition_date: "1969-12-18",
            },
        ]);

        await expect(
            queryArchiveCoverage({
                startDate: "1960-01-01",
                endDate: "1969-12-31",
                category: "Sports",
            }),
        ).resolves.toEqual({
            editionCount: 42,
            articleCount: 1234,
            earliestEditionDate: "1960-01-07",
            latestEditionDate: "1969-12-18",
            retrievalTarget: "legacy",
        });

        expect(mockSql.query.mock.calls[0][1]).toEqual([
            "1960-01-01",
            "1969-12-31",
            "Sports",
        ]);
        expect(mockSql.query.mock.calls[0][0]).toContain("scoped_editions");
        expect(mockSql.query.mock.calls[0][0]).toContain("scoped_articles");
    });

    it("counts only articles attached to the validated versioned build", async () => {
        vi.stubEnv("RAG_RETRIEVAL_MODE", "versioned");
        vi.stubEnv("RAG_ACTIVE_INDEX_BUILD_ID", "build-v3");
        _setRagV2TablesAvailableForTests(true);
        _setRagIndexBuildReadyForTests(true);
        mockSql.query.mockResolvedValueOnce([
            {
                edition_count: 10,
                article_count: 250,
                earliest_edition_date: "1970-01-01",
                latest_edition_date: "1979-12-31",
            },
        ]);

        const result = await queryArchiveCoverage();

        expect(result.retrievalTarget).toBe("versioned");
        expect(mockSql.query.mock.calls[0][0]).toContain("article_chunks");
        expect(mockSql.query.mock.calls[0][0]).toContain("article_images");
        expect(mockSql.query.mock.calls[0][0]).toContain("index_build_id = $4");
        expect(mockSql.query.mock.calls[0][1]).toEqual([
            null,
            null,
            null,
            "build-v3",
        ]);
    });

    it("fails closed when the selected versioned build is not ready", async () => {
        vi.stubEnv("RAG_RETRIEVAL_MODE", "versioned");
        vi.stubEnv("RAG_ACTIVE_INDEX_BUILD_ID", "unready-build");
        _setRagV2TablesAvailableForTests(true);
        _setRagIndexBuildReadyForTests(false);

        await expect(queryArchiveCoverage()).rejects.toThrow("not ready");
        expect(mockSql.query).not.toHaveBeenCalled();
    });

    it("honors an already-aborted request without touching Neon", async () => {
        const controller = new AbortController();
        controller.abort();

        await expect(
            queryArchiveCoverage({ signal: controller.signal, timeoutMs: 500 }),
        ).rejects.toBeInstanceOf(DbTimeoutError);
        expect(mockSql.query).not.toHaveBeenCalled();
    });
});
