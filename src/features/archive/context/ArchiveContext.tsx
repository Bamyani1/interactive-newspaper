"use client";

import React, { createContext, useContext, useState, useCallback, useMemo } from "react";
import type { EditionInfo } from "@/src/types";

interface ArchiveContextType {
    currentDate: string | null;
    setDate: (date: string | null) => void;
    editions: string[];
    editionInfo: EditionInfo[];
    hasEditions: boolean;
}

const ArchiveContext = createContext<ArchiveContextType | null>(null);

interface ArchiveProviderProps {
    initialEditions: EditionInfo[];
    children: React.ReactNode;
}

export const ArchiveProvider: React.FC<ArchiveProviderProps> = ({ initialEditions, children }) => {
    const [currentDate, setCurrentDate] = useState<string | null>(null);

    const setDate = useCallback((date: string | null) => {
        setCurrentDate(date);
    }, []);

    const editions = useMemo(
        () => initialEditions.map((e) => e.date).sort((a, b) => a.localeCompare(b)),
        [initialEditions]
    );
    const hasEditions = editions.length > 0;

    const value = useMemo<ArchiveContextType>(() => ({
        currentDate,
        setDate,
        editions,
        editionInfo: initialEditions,
        hasEditions,
    }), [currentDate, setDate, editions, initialEditions, hasEditions]);

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
