"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

const STORAGE_KEY = "transcript-mode";

// Direction A (Faithful) — canonical palette per /design.md.
// Frozen --owu-* token names remain as internal aliases in colors.css
// so any legacy localStorage entry writing these properties is harmless.
const DEFAULT_LIGHT_TOKENS: Record<string, string> = {
    "--owu-red": "#B80D3E",
    "--owu-black": "#1B1917",
    "--owu-charcoal": "#3A3834",
    "--owu-white": "#FBF8F1",
};

const DEFAULT_DARK_TOKENS: Record<string, string> = {
    "--owu-red": "#B80D3E",
    "--owu-black": "#1B1917",
    "--owu-charcoal": "#3A3834",
    "--owu-white": "#FBF8F1",
};

function applyTokens(tokens: Record<string, string>) {
    const root = document.documentElement;
    for (const [prop, value] of Object.entries(tokens)) {
        root.style.setProperty(prop, value);
    }
}

export const ThemeModeManager = () => {
    const pathname = usePathname();
    const isLanding = pathname === "/";

    useEffect(() => {
        if (typeof window === "undefined") return;

        if (isLanding) {
            document.body.dataset.mode = "dark";
            applyTokens(DEFAULT_DARK_TOKENS);
            return;
        }

        const stored = window.localStorage.getItem(STORAGE_KEY);
        const next = stored === "dark" ? "dark" : "light";

        if (document.body.dataset.mode !== next) {
            document.body.dataset.mode = next;
        }

        applyTokens(next === "light" ? DEFAULT_LIGHT_TOKENS : DEFAULT_DARK_TOKENS);
    }, [isLanding]);

    return null;
};
