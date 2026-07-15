import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { SearchFilters } from "@/features/search/components/SearchFilters";
import { SearchBar } from "@/features/search/components/SearchBar";
import { SearchResults } from "@/features/search/components/SearchResults";
import { SearchResultCard } from "@/features/search/components/SearchResultCard";
import { useSearch } from "@/features/search/hooks/useSearch";
import type { SearchResult } from "@/src/types";

const result: SearchResult = {
    id: "article-1",
    editionDate: "1988-10-12",
    category: "News",
    headline: "Archive headline",
    summary: "Summary",
    byline: "Staff",
    snippet: "Matching <mark>archive</mark> text",
    rank: 1,
};

describe("Search accessibility", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("groups and labels every search filter", () => {
        render(
            <SearchFilters
                category=""
                onCategoryChange={vi.fn()}
                startDate=""
                onStartDateChange={vi.fn()}
                endDate=""
                onEndDateChange={vi.fn()}
            />,
        );

        expect(
            screen.getByRole("group", { name: /filter archive search results/i }),
        ).toBeInTheDocument();
        expect(screen.getByLabelText("Category")).toBeInTheDocument();
        expect(screen.getByLabelText("From date")).toBeInTheDocument();
        expect(screen.getByLabelText("To date")).toBeInTheDocument();

        for (const control of [
            screen.getByLabelText("Category"),
            screen.getByLabelText("From date"),
            screen.getByLabelText("To date"),
        ]) {
            expect(control.className).toContain("search-filter-control");
            expect(control).not.toHaveAttribute("style");
        }
    });

    it("announces loading and result counts while exposing busy state", () => {
        const { rerender } = render(
            <SearchResults
                results={[]}
                pagination={null}
                isLoading={true}
                error={null}
                query="campus"
                onLoadMore={vi.fn()}
            />,
        );

        const region = screen.getByRole("region", { name: "Search results" });
        const status = screen.getByRole("status");
        expect(region).toHaveAttribute(
            "aria-busy",
            "true",
        );
        expect(status).toHaveTextContent(
            "Searching for campus.",
        );
        expect(region).not.toContainElement(status);

        rerender(
            <SearchResults
                results={[result]}
                pagination={{ total: 1, limit: 20, offset: 0, hasMore: false }}
                isLoading={false}
                error={null}
                query="campus"
                onLoadMore={vi.fn()}
            />,
        );
        expect(screen.getByRole("status")).toHaveTextContent(
            "1 result found for campus.",
        );
        const count = screen.getByText("1 result found");
        expect(count.className).toContain("text-[var(--color-text-secondary)]");
        expect(count.className).not.toContain("opacity-50");

        const date = screen.getByText("1988-10-12");
        expect(date.className).toContain("text-[var(--color-text-secondary)]");
        expect(date.className).not.toContain("opacity-50");
    });

    it("disables the search spinner animation for reduced motion", () => {
        render(
            <SearchBar
                value="campus"
                onChange={vi.fn()}
                isLoading
                autoFocus={false}
            />,
        );

        const spinner = document.querySelector(".animate-spin");
        expect(spinner).not.toBeNull();
        expect(spinner?.className).toContain("motion-reduce:animate-none");
    });

    it("clears stale errors synchronously when the query is cleared", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({ ok: false, status: 500 }) as unknown as typeof fetch,
        );
        const { result: hook } = renderHook(() => useSearch({ debounceMs: 0 }));

        act(() => hook.current.setQuery("broken"));
        await waitFor(() => expect(hook.current.error).not.toBeNull());
        act(() => hook.current.setQuery(""));

        expect(hook.current.error).toBeNull();
        expect(hook.current.isLoading).toBe(false);
        expect(hook.current.results).toEqual([]);
    });

    it("keeps edition results as client-navigation links", () => {
        render(<SearchResultCard result={result} />);
        const link = screen.getByRole("link", { name: "Archive headline" });
        expect(link).toHaveAttribute("href", "/edition/1988-10-12");
        expect(link.className).toContain("min-h-[44px]");
    });
});
