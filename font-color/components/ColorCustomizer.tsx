"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { PRESETS, PRESET_CATEGORIES, type ColorPreset } from "../data/colorPresets";

const TOKEN_GROUPS = [
    {
        label: "OWU Brand",
        tokens: [
            { name: "--owu-red", label: "OWU Red" },
            { name: "--owu-black", label: "OWU Black" },
            { name: "--owu-charcoal", label: "OWU Charcoal" },
            { name: "--owu-white", label: "OWU White" },
        ],
    },
] as const;

const ALL_TOKENS = TOKEN_GROUPS.flatMap((group) => group.tokens);
const PRESET_TOKENS = ALL_TOKENS.map((token) => token.name);

const STORAGE_THEME_KEY = "tts-theme";
const STORAGE_APP_MODE_KEY = "transcript-mode";

type ThemeMode = "dark" | "light";

function rgbToHex(rgb: string): string {
    const match = rgb.match(/\d+/g);
    if (!match || match.length < 3) return "#000000";
    return (
        "#" +
        match
            .slice(0, 3)
            .map((n) => Number.parseInt(n, 10).toString(16).padStart(2, "0"))
            .join("")
    );
}

function normalizeColor(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) return "#000000";
    if (trimmed.startsWith("#")) return trimmed.toLowerCase();
    return rgbToHex(trimmed).toLowerCase();
}

const presetsByCategory = PRESET_CATEGORIES.map((category) => ({
    category,
    presets: PRESETS.filter((preset) => preset.category === category),
})).filter((group) => group.presets.length > 0);

function applyThemeMode(mode: ThemeMode) {
    document.body.dataset.mode = mode;

    if (mode === "light") {
        document.documentElement.classList.add("light");
    } else {
        document.documentElement.classList.remove("light");
    }

    localStorage.setItem(STORAGE_APP_MODE_KEY, mode);
    localStorage.setItem(STORAGE_THEME_KEY, mode);
    window.dispatchEvent(new Event("theme-change"));
}

function readCurrentTokenMap(): Record<string, string> {
    const computed = getComputedStyle(document.documentElement);
    const next: Record<string, string> = {};

    for (const token of ALL_TOKENS) {
        const raw = computed.getPropertyValue(token.name);
        next[token.name] = normalizeColor(raw);
    }

    return next;
}

export default function ColorCustomizer() {
    const pathname = usePathname();
    const [open, setOpen] = useState(false);
    const [colors, setColors] = useState<Record<string, string>>(() => {
        if (typeof window === "undefined") return {};
        return readCurrentTokenMap();
    });


    useEffect(() => {
        const handler = (e: Event) => {
            if ((e as CustomEvent).detail !== "color") {
                setOpen(false);
            }
        };

        window.addEventListener("customizer-panel-open", handler);
        return () => window.removeEventListener("customizer-panel-open", handler);
    }, []);

    useEffect(() => {
        if (!open) return;

        window.dispatchEvent(
            new CustomEvent("customizer-panel-open", {
                detail: "color",
            })
        );
    }, [open]);

    const handleChange = useCallback((tokenName: string, value: string) => {
        document.documentElement.style.setProperty(tokenName, value);
        setColors((prev) => ({ ...prev, [tokenName]: value.toLowerCase() }));
    }, []);

    const applyPreset = useCallback((preset: ColorPreset) => {
        applyThemeMode(preset.mode);

        for (const [token, value] of Object.entries(preset.colors)) {
            document.documentElement.style.setProperty(token, value);
        }

        setColors(readCurrentTokenMap());
    }, []);

    const activePresetId = useMemo(() => {
        for (const preset of PRESETS) {
            const match = PRESET_TOKENS.every((token) => {
                return normalizeColor(colors[token] ?? "") === normalizeColor(preset.colors[token]);
            });

            if (match) return preset.id;
        }

        return null;
    }, [colors]);

    const handleReset = useCallback(() => {
        for (const token of ALL_TOKENS) {
            document.documentElement.style.removeProperty(token.name);
        }

        applyThemeMode("dark");
        setColors(readCurrentTokenMap());
    }, []);

    const handleCopy = useCallback(() => {
        const lines = ALL_TOKENS.map((token) => `    ${token.name}: ${colors[token.name]};`);
        const css = `:root {\n${lines.join("\n")}\n}`;
        navigator.clipboard.writeText(css);
    }, [colors]);

    if (!pathname.startsWith("/edition")) {
        return null;
    }

    return (
        <>
            <button
                className="color-customizer-toggle"
                onClick={() => setOpen((prev) => !prev)}
                title="Color Customizer"
                aria-label="Toggle color customizer"
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
                    <circle cx="13.5" cy="6.5" r="2.5" />
                    <circle cx="17.5" cy="10.5" r="2.5" />
                    <circle cx="8.5" cy="7.5" r="2.5" />
                    <circle cx="6.5" cy="12.5" r="2.5" />
                    <path d="M12 22C6.5 22 2 17.5 2 12S6.5 2 12 2s10 4.5 10 10-1.5 4-3 4h-1.8c-.8 0-1.2.9-.7 1.5.3.4.5.9.5 1.5 0 1.1-.9 2-2 2z" />
                </svg>
            </button>

            {open && (
                <div className="color-customizer-panel">
                    <div className="color-customizer-header">
                        <span className="color-customizer-title">Colors</span>
                        <div className="color-customizer-actions">
                            <button onClick={handleCopy}>Copy CSS</button>
                            <button onClick={handleReset}>Reset</button>
                        </div>
                    </div>

                    <div className="color-customizer-scroll">
                        <div className="color-customizer-group">Presets</div>
                        {presetsByCategory.map((group) => (
                            <div key={group.category}>
                                <div className="color-customizer-category">{group.category}</div>
                                <div className="color-customizer-presets">
                                    {group.presets.map((preset) => (
                                        <button
                                            key={preset.id}
                                            className={`color-customizer-swatch${activePresetId === preset.id ? " active" : ""}`}
                                            onClick={() => applyPreset(preset)}
                                            title={preset.name}
                                        >
                                            <span
                                                className="color-customizer-swatch-color"
                                                style={{
                                                    background: `linear-gradient(135deg, ${preset.colors["--owu-black"]} 0%, ${preset.colors["--owu-red"]} 50%, ${preset.colors["--owu-white"]} 100%)`,
                                                }}
                                            />
                                            <span className="color-customizer-swatch-name">
                                                {preset.name}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ))}

                        {TOKEN_GROUPS.map((group) => (
                            <div key={group.label}>
                                <div className="color-customizer-group">{group.label}</div>
                                {group.tokens.map((token) => (
                                    <div className="color-customizer-row" key={token.name}>
                                        <label className="color-customizer-label">{token.label}</label>
                                        <input
                                            type="color"
                                            value={colors[token.name] ?? "#000000"}
                                            onChange={(e) => handleChange(token.name, e.target.value)}
                                            aria-label={`Color for ${token.label}`}
                                        />
                                        <span className="color-customizer-hex">
                                            {colors[token.name] ?? ""}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </>
    );
}
