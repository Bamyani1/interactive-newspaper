"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";
import type { EditionInfo } from "@/src/types";

interface ArchiveContextType {
    currentDate: string | null;
    setDate: (date: string | null) => void;
    editions: string[];
    editionInfo: EditionInfo[];
    hasEditions: boolean;
    isLoading: boolean;
    error: Error | null;
}

const ArchiveContext = createContext<ArchiveContextType | null>(null);

export const ArchiveProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [currentDate, setCurrentDate] = useState<string | null>(null);
    const [editionInfo, setEditionInfo] = useState<EditionInfo[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);

    // Fetch editions once on mount
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
        return () => { cancelled = true; };
    }, []);

    const setDate = useCallback((date: string | null) => {
        setCurrentDate(date);
    }, []);

    const editions = useMemo(
        () => editionInfo.map((e) => e.date).sort((a, b) => a.localeCompare(b)),
        [editionInfo]
    );
    const hasEditions = editions.length > 0;

    const value = useMemo<ArchiveContextType>(() => ({
        currentDate,
        setDate,
        editions,
        editionInfo,
        hasEditions,
        isLoading,
        error,
    }), [currentDate, setDate, editions, editionInfo, hasEditions, isLoading, error]);

    return (
        <ArchiveContext.Provider value={value}>
            {children}
        </ArchiveContext.Provider>
    );
};

export const useArchive = () => {
    const ctx = useContext(ArchiveContext);
    if (!ctx) throw new Error("useArchive must be used within ArchiveProvider");
    return ctx;
};
