"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import {
    DEFAULT_LIGHT_TOKENS,
    PRESET_STORAGE_KEY,
} from "@/font-color/data/colorPresets";

const STORAGE_KEY = "transcript-mode";

export const ThemeModeManager = () => {
    const pathname = usePathname();
    const isLanding = pathname === "/";

    useEffect(() => {
        if (typeof window === "undefined") return;

        const root = document.documentElement;

        if (isLanding) {
            document.body.dataset.mode = "dark";
            for (const prop of Object.keys(DEFAULT_LIGHT_TOKENS)) {
                root.style.removeProperty(prop);
            }
            return;
        }

        const stored = window.localStorage.getItem(STORAGE_KEY);
        const next = stored === "light" ? "light" : "dark";

        if (document.body.dataset.mode !== next) {
            document.body.dataset.mode = next;
        }

        const hasPreset = !!window.localStorage.getItem(PRESET_STORAGE_KEY);
        if (!hasPreset) {
            if (next === "light") {
                for (const [prop, value] of Object.entries(DEFAULT_LIGHT_TOKENS)) {
                    root.style.setProperty(prop, value);
                }
            } else {
                for (const prop of Object.keys(DEFAULT_LIGHT_TOKENS)) {
                    root.style.removeProperty(prop);
                }
            }
        }
    }, [isLanding]);

    return null;
};
