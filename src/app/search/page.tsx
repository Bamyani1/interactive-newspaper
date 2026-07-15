"use client";

import React from "react";
import { PageShell } from "@/shared";
import { TimeControls } from "@/features/time-controls";
import { SiteFooter } from "@/features/footer";
import { SearchBar, SearchFilters, SearchResults, useSearch } from "@/features/search";

export default function SearchPage() {
  const {
    query,
    setQuery,
    category,
    setCategory,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    results,
    pagination,
    isLoading,
    error,
    loadMore,
  } = useSearch();

  return (
    <PageShell variant="default" hasHeader>
      <TimeControls />
      <main id="main-content" tabIndex={-1} className="w-full flex-1">
        <div className="max-w-3xl mx-auto px-6 py-10">
          <p className="text-xs uppercase tracking-widest text-[var(--color-text-secondary)] mb-3">
            Search
          </p>
          <h1 className="font-header text-3xl mb-6">Search the Archive</h1>

          <div className="flex flex-col gap-4 mb-8">
            <SearchBar
              value={query}
              onChange={setQuery}
              isLoading={isLoading}
            />
            <SearchFilters
              category={category}
              onCategoryChange={setCategory}
              startDate={startDate}
              onStartDateChange={setStartDate}
              endDate={endDate}
              onEndDateChange={setEndDate}
            />
          </div>

          <SearchResults
            results={results}
            pagination={pagination}
            isLoading={isLoading}
            error={error}
            query={query}
            onLoadMore={loadMore}
          />
        </div>
      </main>
      <SiteFooter />
    </PageShell>
  );
}
