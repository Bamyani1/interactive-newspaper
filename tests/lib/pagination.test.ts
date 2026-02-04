/**
 * Unit tests for pagination utility functions.
 */
import { describe, it, expect } from "vitest";
import {
    parsePaginationParams,
    buildPaginationMeta,
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE,
} from "../../src/lib/pagination";

describe("parsePaginationParams", () => {
    it("uses default limit when not provided", () => {
        const params = new URLSearchParams();
        const result = parsePaginationParams(params);

        expect(result.take).toBe(DEFAULT_PAGE_SIZE);
        expect(result.cursor).toBeUndefined();
    });

    it("parses limit parameter", () => {
        const params = new URLSearchParams("limit=10");
        const result = parsePaginationParams(params);

        expect(result.take).toBe(10);
    });

    it("clamps limit to MAX_PAGE_SIZE", () => {
        const params = new URLSearchParams("limit=500");
        const result = parsePaginationParams(params);

        expect(result.take).toBe(MAX_PAGE_SIZE);
    });

    it("uses default for invalid limit", () => {
        const params = new URLSearchParams("limit=invalid");
        const result = parsePaginationParams(params);

        expect(result.take).toBe(DEFAULT_PAGE_SIZE);
    });

    it("parses cursor parameter", () => {
        const params = new URLSearchParams("cursor=abc123");
        const result = parsePaginationParams(params);

        expect(result.cursor).toBe("abc123");
    });

    it("parses category parameter", () => {
        const params = new URLSearchParams("category=sports");
        const result = parsePaginationParams(params);

        expect(result.category).toBe("sports");
    });
});

describe("buildPaginationMeta", () => {
    const mockItems = [
        { id: "1", name: "Item 1" },
        { id: "2", name: "Item 2" },
        { id: "3", name: "Item 3" },
    ];

    it("sets hasMore=false when items equal take", () => {
        const result = buildPaginationMeta(mockItems, 3, (item) => item.id);

        expect(result.pagination.hasMore).toBe(false);
        expect(result.data.length).toBe(3);
    });

    it("sets hasMore=true when items exceed take", () => {
        const result = buildPaginationMeta(mockItems, 2, (item) => item.id);

        expect(result.pagination.hasMore).toBe(true);
        expect(result.data.length).toBe(2);
    });

    it("returns nextCursor from last item when hasMore", () => {
        const result = buildPaginationMeta(mockItems, 2, (item) => item.id);

        expect(result.pagination.nextCursor).toBe("2");
    });

    it("returns null nextCursor when no more items", () => {
        const result = buildPaginationMeta(mockItems, 5, (item) => item.id);

        expect(result.pagination.nextCursor).toBeNull();
    });

    it("includes total when provided", () => {
        const result = buildPaginationMeta(mockItems, 3, (item) => item.id, 100);

        expect(result.pagination.total).toBe(100);
    });
});
