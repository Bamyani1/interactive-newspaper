"use client";

import React, { useLayoutEffect, useState } from "react";

const STORAGE_KEY = "transcript-mode";

type ThemeMode = "dark" | "light";

const getInitialMode = (): ThemeMode => {
    if (typeof window === "undefined") return "dark";
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === "light" ? "light" : "dark";
};

export const ThemeModeToggle: React.FC = () => {
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
