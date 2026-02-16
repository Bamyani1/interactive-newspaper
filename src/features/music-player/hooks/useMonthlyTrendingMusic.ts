"use client";

import { useEffect, useMemo, useState } from "react";
import type { MonthlyTrendingApiResponse, MonthlyTrendingRecord } from "@/src/types";

interface UseMonthlyTrendingMusicResult {
  record: MonthlyTrendingRecord | null;
  tracks: MonthlyTrendingRecord["tracks"];
  sourceLabel: string;
  monthLabel: string;
  monthNameOnly: string;
  isLoading: boolean;
  error: Error | null;
  reason: MonthlyTrendingApiResponse["reason"];
}

const responseCache = new Map<string, MonthlyTrendingApiResponse>();
const inFlight = new Map<string, Promise<MonthlyTrendingApiResponse>>();

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function monthFromDate(date: string): string | null {
  if (!isIsoDate(date)) {
    return null;
  }

  return date.slice(0, 7);
}

function formatMonth(month: string): string {
  const date = new Date(`${month}-01T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return month;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function formatMonthNameOnly(month: string): string {
  const date = new Date(`${month}-01T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return month;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    timeZone: "UTC",
  }).format(date);
}

function sourceToLabel(source: MonthlyTrendingRecord["source"]): string {
  switch (source) {
    case "BILLBOARD_HOT100_MONTHLY_ARCHIVE":
      return "Billboard Hot 100 (monthly)";
    default:
      return "Trending Music";
  }
}

async function fetchMonthlyMusic(date: string, cacheKey: string): Promise<MonthlyTrendingApiResponse> {
  const cached = responseCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const existing = inFlight.get(cacheKey);
  if (existing) {
    return existing;
  }

  const pending = fetch(`/api/music?date=${encodeURIComponent(date)}`)
    .then(async (response) => {
      const payload = (await response.json()) as MonthlyTrendingApiResponse;
      return payload;
    })
    .finally(() => {
      inFlight.delete(cacheKey);
    });

  inFlight.set(cacheKey, pending);
  const resolved = await pending;
  responseCache.set(cacheKey, resolved);
  return resolved;
}

export function useMonthlyTrendingMusic(date: string | null): UseMonthlyTrendingMusicResult {
  const [record, setRecord] = useState<MonthlyTrendingRecord | null>(null);
  const [reason, setReason] = useState<MonthlyTrendingApiResponse["reason"]>(null);
  const [isLoading, setIsLoading] = useState(Boolean(date));
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!date) {
        if (!cancelled) {
          setRecord(null);
          setReason(null);
          setError(null);
          setIsLoading(false);
        }
        return;
      }

      const month = monthFromDate(date);
      if (!month) {
        if (!cancelled) {
          setRecord(null);
          setReason("INVALID_DATE");
          setError(null);
          setIsLoading(false);
        }
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const payload = await fetchMonthlyMusic(date, month);
        if (!cancelled) {
          setRecord(payload.record);
          setReason(payload.reason);
        }
      } catch (value) {
        if (!cancelled) {
          setRecord(null);
          setReason(null);
          setError(value instanceof Error ? value : new Error("Failed to load monthly music"));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [date]);

  const sourceLabel = useMemo(() => {
    if (!record) {
      return "";
    }

    return sourceToLabel(record.source);
  }, [record]);

  const monthLabel = useMemo(() => {
    if (!record?.month) {
      const month = date ? monthFromDate(date) : null;
      return month ? formatMonth(month) : "";
    }

    return formatMonth(record.month);
  }, [date, record]);

  const monthNameOnly = useMemo(() => {
    if (!record?.month) {
      const month = date ? monthFromDate(date) : null;
      return month ? formatMonthNameOnly(month) : "";
    }

    return formatMonthNameOnly(record.month);
  }, [date, record]);

  return {
    record,
    tracks: record?.tracks ?? [],
    sourceLabel,
    monthLabel,
    monthNameOnly,
    isLoading,
    error,
    reason,
  };
}

export function clearMonthlyTrendingMusicCacheForTests(): void {
  responseCache.clear();
  inFlight.clear();
}
