"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { SearchResult, PaginationInfo } from "@/src/types";

interface UseSearchOptions {
  debounceMs?: number;
}

interface UseSearchResult {
  query: string;
  setQuery: (q: string) => void;
  category: string;
  setCategory: (c: string) => void;
  startDate: string;
  setStartDate: (d: string) => void;
  endDate: string;
  setEndDate: (d: string) => void;
  results: SearchResult[];
  pagination: PaginationInfo | null;
  isLoading: boolean;
  error: Error | null;
  loadMore: () => void;
}

export function useSearch(options: UseSearchOptions = {}): UseSearchResult {
  const { debounceMs = 300 } = options;

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [pagination, setPagination] = useState<PaginationInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [offset, setOffset] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchResults = useCallback(
    async (q: string, cat: string, start: string, end: string, currentOffset: number) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      if (!q.trim()) {
        setResults([]);
        setPagination(null);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({ q: q.trim(), limit: "20", offset: String(currentOffset) });
        if (cat) params.set("category", cat);
        if (start) params.set("start_date", start);
        if (end) params.set("end_date", end);

        const res = await fetch(`/api/search?${params}`, { signal: controller.signal });
        if (!res.ok) throw new Error(`Search failed: ${res.status}`);

        const data = await res.json();

        setResults((prev) => (currentOffset === 0 ? data.results : [...prev, ...data.results]));
        setPagination(data.pagination);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err : new Error("Search failed"));
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    },
    [],
  );

  // Debounced search on query/filter changes
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setOffset(0);

    timerRef.current = setTimeout(() => {
      fetchResults(query, category, startDate, endDate, 0);
    }, debounceMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, category, startDate, endDate, debounceMs, fetchResults]);

  const loadMore = useCallback(() => {
    if (!pagination?.hasMore || isLoading) return;
    const nextOffset = offset + 20;
    setOffset(nextOffset);
    fetchResults(query, category, startDate, endDate, nextOffset);
  }, [pagination, isLoading, offset, query, category, startDate, endDate, fetchResults]);

  return {
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
  };
}
