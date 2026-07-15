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
  let announcement = "";
  let content: React.ReactNode;

  if (!query.trim()) {
    announcement = "Enter a search term to explore the archive.";
    content = (
      <div className="py-12 text-center text-[var(--color-text-secondary)]">
        Enter a search term to explore the archive.
      </div>
    );
  } else if (error) {
    announcement = "Search failed. Please try again.";
    content = (
      <div className="py-8 text-center opacity-70 text-[var(--color-text-primary)]">
        Search failed. Please try again.
      </div>
    );
  } else if (isLoading && results.length === 0) {
    announcement = `Searching for ${query}.`;
    content = <SkeletonFeed count={3} />;
  } else if (!isLoading && results.length === 0) {
    announcement = `No results found for ${query}.`;
    content = (
      <div className="py-8 text-center opacity-70 text-[var(--color-text-primary)]">
        No results found for &ldquo;{query}&rdquo;.
      </div>
    );
  } else {
    const total = pagination?.total ?? results.length;
    announcement = isLoading
      ? `Loading more results for ${query}.`
      : `${total} result${total === 1 ? "" : "s"} found for ${query}.`;
    content = (
      <div>
        {pagination && (
          <p className="mb-4 text-sm text-[var(--color-text-secondary)]">
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
              className="min-h-[44px] px-6 py-2 text-sm uppercase tracking-label-md transition-colors hover:opacity-80 disabled:opacity-40 text-[var(--color-accent-text)] border border-[var(--color-accent-text)] rounded-sm bg-transparent focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus-ring)]"
            >
              {isLoading ? "Loading..." : "Load More"}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
      <section aria-labelledby="search-results-heading" aria-busy={isLoading}>
        <h2 id="search-results-heading" className="sr-only">
          Search results
        </h2>
        {content}
      </section>
    </>
  );
};
