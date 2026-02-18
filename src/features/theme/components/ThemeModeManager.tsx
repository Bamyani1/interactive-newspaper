"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import {
    DEFAULT_DARK_TOKENS,
    DEFAULT_LIGHT_TOKENS,
    PRESETS,
    PRESET_STORAGE_KEY,
} from "@/font-color/data/colorPresets";

const STORAGE_KEY = "transcript-mode";

function applyTokens(tokens: Record<string, string>) {
    const root = document.documentElement;
    for (const [prop, value] of Object.entries(tokens)) {
        root.style.setProperty(prop, value);
    }
}

function resolveTokens(mode: "dark" | "light"): Record<string, string> {
    const storedId = window.localStorage.getItem(PRESET_STORAGE_KEY);
    if (storedId) {
        const preset = PRESETS.find((p) => p.id === storedId);
        if (preset) return preset.colors;
        window.localStorage.removeItem(PRESET_STORAGE_KEY);
    }
    return mode === "light" ? DEFAULT_LIGHT_TOKENS : DEFAULT_DARK_TOKENS;
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
        const next = stored === "light" ? "light" : "dark";

        if (document.body.dataset.mode !== next) {
            document.body.dataset.mode = next;
        }

        applyTokens(resolveTokens(next));
    }, [isLanding]);

    return null;
};
