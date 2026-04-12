"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { FONT_PRESETS, type FontPreset } from "../data/fontPresets";

const FONT_VARS = [
    "--font-header",
    "--font-body",
    "--font-masthead",
    "--font-mono",
    "--font-accent",
] as const;

const STORAGE_KEY = "tts-font-preset";
const loadedFonts = new Set<string>();

function loadGoogleFonts(families: string[]) {
    const toLoad = families.filter((family) => !loadedFonts.has(family));
    if (toLoad.length === 0) return;

    for (const family of toLoad) {
        loadedFonts.add(family);
    }

    const params = toLoad
        .map(
            (family) =>
                "family=" +
                encodeURIComponent(family).replace(/%20/g, "+") +
                ":wght@300;400;500;600;700"
        )
        .join("&");

    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?${params}&display=swap`;
    document.head.appendChild(link);
}

function preloadAllPresetFonts() {
    const allFamilies = new Set<string>();

    for (const preset of FONT_PRESETS) {
        for (const family of preset.googleFontsToLoad) {
            allFamilies.add(family);
        }
    }

    loadGoogleFonts(Array.from(allFamilies));
}

function extractPrimaryFamily(fontValue: string): string {
    const first = fontValue.split(",")[0].trim();
    return first.replace(/"/g, "");
}

export default function FontCustomizer() {
    const pathname = usePathname();
    const [open, setOpen] = useState(false);
    const [activeId, setActiveId] = useState(() => {
        if (typeof window === "undefined") return "owu-default";
        const saved = localStorage.getItem(STORAGE_KEY);
        return FONT_PRESETS.some((entry) => entry.id === saved) ? saved : "owu-default";
    });

    useEffect(() => {
        if (activeId === "owu-default") return;

        const preset = FONT_PRESETS.find((entry) => entry.id === activeId);
        if (!preset) return;

        if (preset.googleFontsToLoad.length > 0) {
            loadGoogleFonts(preset.googleFontsToLoad);
        }

        for (const variable of FONT_VARS) {
            document.documentElement.style.setProperty(variable, preset.fonts[variable]);
        }
    }, [activeId]);

    useEffect(() => {
        const handler = (e: Event) => {
            if ((e as CustomEvent).detail !== "font") {
                setOpen(false);
            }
        };

        window.addEventListener("customizer-panel-open", handler);
        return () => window.removeEventListener("customizer-panel-open", handler);
    }, []);

    useEffect(() => {
        if (!open) return;

        window.dispatchEvent(
            new CustomEvent("customizer-panel-open", { detail: "font" })
        );
    }, [open]);

    useEffect(() => {
        if (open) {
            preloadAllPresetFonts();
        }
    }, [open]);

    const handleToggle = useCallback(() => {
        setOpen((prev) => !prev);
    }, []);

    const applyPreset = useCallback((preset: FontPreset) => {
        if (preset.googleFontsToLoad.length > 0) {
            loadGoogleFonts(preset.googleFontsToLoad);
        }

        for (const variable of FONT_VARS) {
            document.documentElement.style.setProperty(variable, preset.fonts[variable]);
        }

        localStorage.setItem(STORAGE_KEY, preset.id);
        setActiveId(preset.id);
    }, []);

    const handleReset = useCallback(() => {
        for (const variable of FONT_VARS) {
            document.documentElement.style.removeProperty(variable);
        }

        localStorage.removeItem(STORAGE_KEY);
        setActiveId("owu-default");
    }, []);

    if (pathname !== "/" && !pathname.startsWith("/edition")) {
        return null;
    }

    return (
        <>
            <button
                className="font-customizer-toggle"
                onClick={handleToggle}
                title="Font Customizer"
                aria-label="Toggle font customizer"
            >
                <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                >
                    <polyline points="4 7 4 4 20 4 20 7" />
                    <line x1="9" y1="20" x2="15" y2="20" />
                    <line x1="12" y1="4" x2="12" y2="20" />
                </svg>
            </button>

            {open && (
                <div className="font-customizer-panel">
                    <div className="font-customizer-header">
                        <span className="font-customizer-title">Fonts</span>
                        <button className="font-customizer-reset" onClick={handleReset}>
                            Reset
                        </button>
                    </div>

                    <div className="font-customizer-scroll">
                        {FONT_PRESETS.map((preset) => (
                            <button
                                key={preset.id}
                                className={`font-customizer-preset${activeId === preset.id ? " active" : ""}`}
                                onClick={() => applyPreset(preset)}
                            >
                                <div className="font-preset-info">
                                    <span className="font-preset-name">{preset.name}</span>
                                    <span className="font-preset-name-en">{preset.nameEn}</span>
                                </div>

                                <div
                                    className="font-preset-preview"
                                    style={{ fontFamily: preset.fonts["--font-header"] }}
                                >
                                    The Transcript Archive - Ohio Wesleyan University
                                </div>

                                <div
                                    className="font-preset-preview-latin"
                                    style={{ fontFamily: preset.fonts["--font-body"] }}
                                >
                                    Campus voices, archived in print.
                                </div>

                                <div className="font-preset-families">
                                    {extractPrimaryFamily(preset.fonts["--font-header"])} /{" "}
                                    {extractPrimaryFamily(preset.fonts["--font-body"])} /{" "}
                                    {extractPrimaryFamily(preset.fonts["--font-mono"])}
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </>
    );
}
