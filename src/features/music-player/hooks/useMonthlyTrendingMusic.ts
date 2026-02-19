"use client";

import { useEffect, useMemo, useState } from "react";
import type { MonthlyTrendingReason, MonthlyTrendingTrack } from "@/src/types";

interface UseMonthlyTrendingMusicResult {
  tracks: MonthlyTrendingTrack[];
  monthLabel: string;
  monthNameOnly: string;
  isLoading: boolean;
  error: Error | null;
  reason: MonthlyTrendingReason;
}

interface RawTrack {
  rank: number;
  title: string;
  artist: string;
  youtube_id: string;
}

type YearData = Record<string, RawTrack[]>;

const yearCache = new Map<string, YearData>();
const inFlight = new Map<string, Promise<YearData | null>>();

const MAX_CACHE_SIZE = 20;
const MIN_YEAR = 1960;
const MAX_YEAR = 2000;

function cacheSet(key: string, value: YearData): void {
  if (yearCache.size >= MAX_CACHE_SIZE) {
    const firstKey = yearCache.keys().next().value;
    if (firstKey !== undefined) yearCache.delete(firstKey);
  }
  yearCache.set(key, value);
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value);
}

function formatMonth(month: string): string {
  const date = new Date(`${month}-01T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return month;
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function formatMonthNameOnly(month: string): string {
  const date = new Date(`${month}-01T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return month;
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    timeZone: "UTC",
  }).format(date);
}

async function fetchYear(year: string): Promise<YearData | null> {
  const cached = yearCache.get(year);
  if (cached) return cached;

  const existing = inFlight.get(year);
  if (existing) return existing;

  const pending = fetch(`/top-10-music/${year}.json`)
    .then(async (response) => {
      if (!response.ok) return null;
      const data = (await response.json()) as YearData;
      cacheSet(year, data);
      return data;
    })
    .catch(() => null)
    .finally(() => {
      inFlight.delete(year);
    });

  inFlight.set(year, pending);
  return pending;
}

export function useMonthlyTrendingMusic(date: string | null): UseMonthlyTrendingMusicResult {
  const [yearData, setYearData] = useState<YearData | null>(null);
  const [reason, setReason] = useState<MonthlyTrendingReason>(null);
  const [isLoading, setIsLoading] = useState(Boolean(date));
  const [error, setError] = useState<Error | null>(null);

  const year = date && isIsoDate(date) ? date.slice(0, 4) : null;
  const monthKey = date && isIsoDate(date) ? date.slice(5, 7) : null;
  const monthStr = date && isIsoDate(date) ? date.slice(0, 7) : null;

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!date || !year || !monthKey) {
        if (!cancelled) {
          setYearData(null);
          setReason(date ? "INVALID_DATE" : null);
          setError(null);
          setIsLoading(false);
        }
        return;
      }

      const yearNum = parseInt(year, 10);
      if (yearNum < MIN_YEAR || yearNum > MAX_YEAR) {
        if (!cancelled) {
          setYearData(null);
          setReason("NO_DATA");
          setError(null);
          setIsLoading(false);
        }
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const data = await fetchYear(year);
        if (!cancelled) {
          if (data) {
            setYearData(data);
            setReason(data[monthKey] ? null : "NO_DATA");
          } else {
            setYearData(null);
            setReason("NO_DATA");
          }
        }
      } catch (value) {
        if (!cancelled) {
          setYearData(null);
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
  }, [date, year, monthKey]);

  const tracks = useMemo<MonthlyTrendingTrack[]>(() => {
    if (!yearData || !monthKey) return [];
    const rawTracks = yearData[monthKey];
    if (!rawTracks) return [];
    return rawTracks.map((track) => ({
      rank: track.rank,
      title: track.title,
      artist: track.artist,
      youtubeId: track.youtube_id,
    }));
  }, [yearData, monthKey]);

  const monthLabel = useMemo(() => {
    return monthStr ? formatMonth(monthStr) : "";
  }, [monthStr]);

  const monthNameOnly = useMemo(() => {
    return monthStr ? formatMonthNameOnly(monthStr) : "";
  }, [monthStr]);

  return {
    tracks,
    monthLabel,
    monthNameOnly,
    isLoading,
    error,
    reason,
  };
}
