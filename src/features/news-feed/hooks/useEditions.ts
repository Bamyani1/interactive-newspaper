"use client";

import { useState, useEffect } from "react";

interface EditionInfo {
    id: string;
    date: string;
    pageCount: number;
    articleCount: number;
}

interface UseEditionsResult {
    editions: string[];
    editionInfo: EditionInfo[];
    isLoading: boolean;
    error: Error | null;
}

export function useEditions(): UseEditionsResult {
    const [editionInfo, setEditionInfo] = useState<EditionInfo[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);

    useEffect(() => {
        let cancelled = false;

        async function fetchEditions() {
            try {
                const res = await fetch("/api/editions");

                if (!res.ok) {
                    throw new Error(`Failed to fetch editions: ${res.status}`);
                }

                const data = await res.json();

                if (!cancelled) {
                    setEditionInfo(data.editions);
                }
            } catch (err) {
                if (!cancelled) {
                    setError(err instanceof Error ? err : new Error("Unknown error"));
                }
            } finally {
                if (!cancelled) {
                    setIsLoading(false);
                }
            }
        }

        fetchEditions();

        return () => {
            cancelled = true;
        };
    }, []);

    // Extract just dates for backward compatibility
    const editions = editionInfo.map((e) => e.date).sort((a, b) => a.localeCompare(b));

    return { editions, editionInfo, isLoading, error };
}
