"use client";

import React from "react";
import { Sun, Moon } from "lucide-react";
import { THEME_STORAGE_KEY, type ThemeMode } from "../lib/theme";

export interface ThemeModeToggleProps {
    /** When true, show only sun/moon icon (e.g. for header). */
    iconOnly?: boolean;
}

export const ThemeModeToggle: React.FC<ThemeModeToggleProps> = ({ iconOnly = false }) => {
    const handleToggle = () => {
        const root = document.documentElement;
        const next: ThemeMode = root.dataset.mode === "dark" ? "light" : "dark";
        root.dataset.mode = next;
        try {
            window.localStorage.setItem(THEME_STORAGE_KEY, next);
        } catch {
            // The selected mode still applies for this page when storage is unavailable.
        }
    };

    if (iconOnly) {
        return (
            <button
                type="button"
                onClick={handleToggle}
                className="flex size-11 shrink-0 items-center justify-center rounded-sm hover:bg-accent/8 hover:text-[var(--color-text-primary)] transition-colors focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                aria-label="Toggle color theme"
            >
                <Sun
                    className="theme-mode-toggle__light-action w-4 h-4 opacity-80"
                    aria-hidden
                />
                <Moon
                    className="theme-mode-toggle__dark-action w-4 h-4 opacity-80"
                    aria-hidden
                />
            </button>
        );
    }

    return (
        <button
            type="button"
            onClick={handleToggle}
            className="hover:text-[var(--color-text-primary)] transition-colors"
            aria-label="Toggle color theme"
        >
            <span className="theme-mode-toggle__light-action">Light Mode</span>
            <span className="theme-mode-toggle__dark-action">Dark Mode</span>
        </button>
    );
};
