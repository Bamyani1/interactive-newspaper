"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

const STORAGE_KEY = "transcript-mode";

export const ThemeModeManager = () => {
    const pathname = usePathname();

    useEffect(() => {
        if (typeof window === "undefined") return;
        if (pathname === "/") {
            document.body.dataset.mode = "dark";
            return;
        }
        const stored = window.localStorage.getItem(STORAGE_KEY);
        const next = stored === "light" ? "light" : "dark";
        document.body.dataset.mode = next;
    }, [pathname]);

    return null;
};
