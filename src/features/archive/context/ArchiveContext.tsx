"use client";

import React, { createContext, useContext, useMemo } from "react";

interface ArchiveContextType {
    editions: string[];
    hasEditions: boolean;
}

const ArchiveContext = createContext<ArchiveContextType | null>(null);

interface ArchiveProviderProps {
    initialEditions: string[];
    children: React.ReactNode;
}

export const ArchiveProvider: React.FC<ArchiveProviderProps> = ({ initialEditions, children }) => {
    const editions = useMemo(
        () => [...initialEditions].sort((a, b) => a.localeCompare(b)),
        [initialEditions]
    );
    const hasEditions = editions.length > 0;

    const value = useMemo<ArchiveContextType>(() => ({
        editions,
        hasEditions,
    }), [editions, hasEditions]);

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
