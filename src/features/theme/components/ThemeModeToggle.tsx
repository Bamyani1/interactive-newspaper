"use client";

import React, { useEffect, useLayoutEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";
import {
    DEFAULT_DARK_TOKENS,
    DEFAULT_LIGHT_TOKENS,
    PRESET_STORAGE_KEY,
} from "@/font-color/data/colorPresets";

const STORAGE_KEY = "transcript-mode";

type ThemeMode = "dark" | "light";

function applyBrandTokens(tokens: Record<string, string>) {
    const root = document.documentElement;
    for (const [prop, value] of Object.entries(tokens)) {
        root.style.setProperty(prop, value);
    }
}

export interface ThemeModeToggleProps {
    /** When true, show only sun/moon icon (e.g. for header). */
    iconOnly?: boolean;
}

export const ThemeModeToggle: React.FC<ThemeModeToggleProps> = ({ iconOnly = false }) => {
    // Always start "dark" on both server and client to avoid hydration mismatch
    const [mode, setMode] = useState<ThemeMode>("dark");

    // Sync with localStorage after mount (must be effect — localStorage unavailable during SSR)
    useEffect(() => {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        if (stored === "light") setMode("light"); // eslint-disable-line react-hooks/set-state-in-effect
    }, []);

    useLayoutEffect(() => {
        document.body.dataset.mode = mode;
        const hasPreset = !!window.localStorage.getItem(PRESET_STORAGE_KEY);
        if (!hasPreset) {
            applyBrandTokens(mode === "light" ? DEFAULT_LIGHT_TOKENS : DEFAULT_DARK_TOKENS);
        }
    }, [mode]);

    const handleToggle = () => {
        const next: ThemeMode = mode === "dark" ? "light" : "dark";
        setMode(next);
        document.body.dataset.mode = next;
        window.localStorage.setItem(STORAGE_KEY, next);

        const hasPreset = !!window.localStorage.getItem(PRESET_STORAGE_KEY);
        if (!hasPreset) {
            applyBrandTokens(next === "light" ? DEFAULT_LIGHT_TOKENS : DEFAULT_DARK_TOKENS);
        }
    };

    const label = mode === "dark" ? "Switch to light mode" : "Switch to dark mode";

    if (iconOnly) {
        return (
            <button
                type="button"
                onClick={handleToggle}
                className="p-1.5 rounded-sm hover:bg-accent/8 hover:text-[var(--color-text-primary)] transition-colors focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
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
