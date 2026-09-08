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
            Explore by keyword
          </p>
          <h1 className="font-header text-2xl sm:text-3xl leading-tight text-balance mb-3">
            Search 56 years of The Transcript
          </h1>
          <p className="max-w-2xl text-base text-[var(--color-text-secondary)] leading-relaxed mb-6">
            Find people, places, headlines, and campus events across editions published from 1950
            through 2006.
          </p>

          <div className="flex flex-col gap-4 mb-8">
            <SearchBar value={query} onChange={setQuery} isLoading={isLoading} />
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
