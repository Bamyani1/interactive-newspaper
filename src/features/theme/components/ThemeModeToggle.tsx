"use client";

import React, { useLayoutEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";

const STORAGE_KEY = "transcript-mode";

type ThemeMode = "dark" | "light";

const getInitialMode = (): ThemeMode => {
    if (typeof window === "undefined") return "dark";
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === "light" ? "light" : "dark";
};

export interface ThemeModeToggleProps {
    /** When true, show only sun/moon icon (e.g. for header). */
    iconOnly?: boolean;
}

export const ThemeModeToggle: React.FC<ThemeModeToggleProps> = ({ iconOnly = false }) => {
    const [mode, setMode] = useState<ThemeMode>(getInitialMode);

    useLayoutEffect(() => {
        document.body.dataset.mode = mode;
    }, [mode]);

    const handleToggle = () => {
        const next: ThemeMode = mode === "dark" ? "light" : "dark";
        setMode(next);
        document.body.dataset.mode = next;
        window.localStorage.setItem(STORAGE_KEY, next);
    };

    const label = mode === "dark" ? "Switch to light mode" : "Switch to dark mode";

    if (iconOnly) {
        return (
            <button
                type="button"
                onClick={handleToggle}
                className="p-1.5 rounded-sm hover:bg-[var(--color-accent)]/8 hover:text-[var(--color-text-primary)] transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-accent)]/30"
                aria-label={label}
                aria-pressed={mode === "light"}
            >
                {mode === "dark" ? (
                    <Sun className="w-4 h-4 opacity-80" aria-hidden />
                ) : (
                    <Moon className="w-4 h-4 opacity-80" aria-hidden />
                )}
            </button>
        );
    }

    return (
        <button
            type="button"
            onClick={handleToggle}
            className="hover:text-[var(--color-text-primary)] transition-colors"
            aria-pressed={mode === "light"}
        >
            {mode === "dark" ? "Light Mode" : "Dark Mode"}
        </button>
    );
};
