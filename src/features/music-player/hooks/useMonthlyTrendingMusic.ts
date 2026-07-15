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

type TrackTuple = [string, string, string];

interface PackedArchive {
  start: string;
  end: string;
  months: Array<TrackTuple[] | null>;
}

interface NormalizedArchive extends PackedArchive {
  startYear: number;
  endYear: number;
}

const ARCHIVE_URL = "/top-10-music/chart-1950-2010.json";

let archivePromise: Promise<NormalizedArchive | null> | null = null;

function parseYear(value: string): number | null {
  const match = /^(\d{4})-\d{2}$/.exec(value);
  if (!match) return null;
  return Number(match[1]);
}

function loadArchive(): Promise<NormalizedArchive | null> {
  if (!archivePromise) {
    archivePromise = fetch(ARCHIVE_URL)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Monthly chart archive error: ${response.status}`);
        }
        const raw = (await response.json()) as PackedArchive;
        const startYear = parseYear(raw.start);
        const endYear = parseYear(raw.end);
        if (startYear == null || endYear == null) return null;
        return { ...raw, startYear, endYear };
      });
  }
  return archivePromise;
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

function monthIndex(year: number, month: number, startYear: number): number {
  return (year - startYear) * 12 + (month - 1);
}

export function useMonthlyTrendingMusic(date: string | null): UseMonthlyTrendingMusicResult {
  const [tuples, setTuples] = useState<TrackTuple[] | null>(null);
  const [reason, setReason] = useState<MonthlyTrendingReason>(null);
  const [isLoading, setIsLoading] = useState(Boolean(date));
  const [error, setError] = useState<Error | null>(null);

  const year = date && isIsoDate(date) ? Number(date.slice(0, 4)) : null;
  const month = date && isIsoDate(date) ? Number(date.slice(5, 7)) : null;
  const monthStr = date && isIsoDate(date) ? date.slice(0, 7) : null;

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!date || year == null || month == null) {
        if (!cancelled) {
          setTuples(null);
          setReason(date ? "INVALID_DATE" : null);
          setError(null);
          setIsLoading(false);
        }
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const archive = await loadArchive();
        if (cancelled) return;

        if (!archive) {
          setTuples(null);
          setReason("NO_DATA");
          return;
        }

        if (year < archive.startYear || year > archive.endYear) {
          setTuples(null);
          setReason("NO_DATA");
          return;
        }

        const idx = monthIndex(year, month, archive.startYear);
        const monthTuples = archive.months[idx] ?? null;
        setTuples(monthTuples);
        setReason(monthTuples ? null : "NO_DATA");
      } catch (value) {
        if (!cancelled) {
          setTuples(null);
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
  }, [date, year, month]);

  const tracks = useMemo<MonthlyTrendingTrack[]>(() => {
    if (!tuples) return [];
    return tuples.map((tuple, i) => ({
      rank: i + 1,
      title: tuple[0],
      artist: tuple[1],
      youtubeId: tuple[2],
    }));
  }, [tuples]);

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

export function clearMonthlyTrendingMusicCacheForTests(): void {
  archivePromise = null;
}
