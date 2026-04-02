"use client";

import React from "react";
import type { SearchResult, PaginationInfo } from "@/src/types";
import { SkeletonFeed } from "@/shared";
import { SearchResultCard } from "./SearchResultCard";

interface SearchResultsProps {
  results: SearchResult[];
  pagination: PaginationInfo | null;
  isLoading: boolean;
  error: Error | null;
  query: string;
  onLoadMore: () => void;
}

export const SearchResults: React.FC<SearchResultsProps> = ({
  results,
  pagination,
  isLoading,
  error,
  query,
  onLoadMore,
}) => {
  if (error) {
    return (
      <div className="py-8 text-center opacity-70" style={{ color: "var(--color-text-primary)" }}>
        Search failed. Please try again.
      </div>
    );
  }

  if (isLoading && results.length === 0 && query.trim()) {
    return <SkeletonFeed count={3} />;
  }

  if (!query.trim()) {
    return (
      <div className="py-12 text-center opacity-50" style={{ color: "var(--color-text-primary)" }}>
        Enter a search term to explore the archive.
      </div>
    );
  }

  if (!isLoading && results.length === 0) {
    return (
      <div className="py-8 text-center opacity-70" style={{ color: "var(--color-text-primary)" }}>
        No results found for &ldquo;{query}&rdquo;.
      </div>
    );
  }

  return (
    <div>
      {pagination && (
        <p className="text-sm opacity-50 mb-4" style={{ color: "var(--color-text-primary)" }}>
          {pagination.total} result{pagination.total !== 1 ? "s" : ""} found
        </p>
      )}

      <div>
        {results.map((result) => (
          <SearchResultCard key={result.id} result={result} />
        ))}
      </div>

      {pagination?.hasMore && (
        <div className="py-6 text-center">
          <button
            onClick={onLoadMore}
            disabled={isLoading}
            className="px-6 py-2 text-sm uppercase tracking-widest transition-colors hover:opacity-80 disabled:opacity-40"
            style={{
              color: "var(--color-accent)",
              border: "1px solid var(--color-accent)",
              borderRadius: "4px",
              backgroundColor: "transparent",
            }}
          >
            {isLoading ? "Loading..." : "Load More"}
          </button>
        </div>
      )}
    </div>
  );
};
