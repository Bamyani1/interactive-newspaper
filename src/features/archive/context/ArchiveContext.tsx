"use client";

import React, { createContext, useContext, useState, ReactNode } from "react";

interface ArchiveContextType {
    currentDate: string;
    setDate: (date: string) => void;
}

const ArchiveContext = createContext<ArchiveContextType | undefined>(undefined);

export const useArchive = () => {
    const context = useContext(ArchiveContext);
    if (!context) {
        throw new Error("useArchive must be used within an ArchiveProvider");
    }
    return context;
};

interface ArchiveProviderProps {
    children: ReactNode;
}

export const ArchiveProvider: React.FC<ArchiveProviderProps> = ({ children }) => {
    // Default to existing extracted edition date
    const [currentDate, setCurrentDate] = useState("1986-10-24");

    const value = {
        currentDate,
        setDate: setCurrentDate,
    };

    return (
        <ArchiveContext.Provider value={value}>
            {children}
        </ArchiveContext.Provider>
    );
};
