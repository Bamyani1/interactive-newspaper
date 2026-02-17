"use client";

import { useEffect, useMemo, useState } from "react";
import type { DailyWeatherRecord } from "@/src/types";

interface WeatherApiResponse {
  record: DailyWeatherRecord | null;
  reason: string | null;
}

interface UseHistoricalWeatherResult {
  record: DailyWeatherRecord | null;
  weatherLabel: string;
  isLoading: boolean;
  error: Error | null;
}

const responseCache = new Map<string, WeatherApiResponse>();
const inFlight = new Map<string, Promise<WeatherApiResponse>>();

const MAX_CACHE_SIZE = 50;

function cacheSet<K, V>(map: Map<K, V>, key: K, value: V): void {
  if (map.size >= MAX_CACHE_SIZE) {
    // Delete the oldest entry (first key in insertion order)
    const firstKey = map.keys().next().value;
    if (firstKey !== undefined) map.delete(firstKey);
  }
  map.set(key, value);
}

function toFahrenheit(valueCelsius: number): number {
  return (valueCelsius * 9) / 5 + 32;
}

function formatTempPair(record: DailyWeatherRecord): string {
  const high = record.tmax_c != null ? `${Math.round(toFahrenheit(record.tmax_c))}°` : null;
  const low = record.tmin_c != null ? `${Math.round(toFahrenheit(record.tmin_c))}°` : null;

  if (high && low) {
    return `${high} / ${low}`;
  }
  if (high) {
    return `High ${high}`;
  }
  if (low) {
    return `Low ${low}`;
  }
  return "Temperature unavailable";
}

async function fetchWeather(date: string): Promise<WeatherApiResponse> {
  const cacheKey = date;
  const cached = responseCache.get(cacheKey);
  if (cached) return cached;

  const existing = inFlight.get(cacheKey);
  if (existing) return existing;

  const pending = fetch(`/api/weather?date=${encodeURIComponent(date)}`)
    .then(async (res) => {
      const payload = (await res.json()) as WeatherApiResponse;
      if (!res.ok) {
        throw new Error(`Weather API error: ${res.status}`);
      }
      return payload;
    })
    .finally(() => {
      inFlight.delete(cacheKey);
    });

  inFlight.set(cacheKey, pending);
  const result = await pending;
  if (result.record != null) {
    cacheSet(responseCache, cacheKey, result);
  }
  return result;
}

export function useHistoricalWeather(date: string | null): UseHistoricalWeatherResult {
  const [record, setRecord] = useState<DailyWeatherRecord | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(date));
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!date) {
        if (!cancelled) {
          setRecord(null);
          setError(null);
          setIsLoading(false);
        }
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const payload = await fetchWeather(date);
        if (!cancelled) {
          setRecord(payload.record);
        }
      } catch (err) {
        if (!cancelled) {
          setRecord(null);
          setError(err instanceof Error ? err : new Error("Failed to load weather"));
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

  const weatherLabel = useMemo(() => {
    if (!date) return "No date selected";
    if (isLoading) return "Loading weather...";
    if (!record) return "Weather unavailable";

    return formatTempPair(record);
  }, [date, isLoading, record]);

  return {
    record,
    weatherLabel,
    isLoading,
    error,
  };
}
