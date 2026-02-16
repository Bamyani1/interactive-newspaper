"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { LAYOUT_DESIGNS } from "../data/layoutDesigns";

const STORAGE_KEY = "tts-layout-design";

export default function LayoutCustomizer() {
    const pathname = usePathname();
    const [open, setOpen] = useState(false);
    const [activeId, setActiveId] = useState(() => {
        if (typeof window === "undefined") return "default";
        const saved = localStorage.getItem(STORAGE_KEY);
        return LAYOUT_DESIGNS.some((d) => d.id === saved) ? saved! : "default";
    });

    useEffect(() => {
        const handler = (e: Event) => {
            if ((e as CustomEvent).detail !== "layout") {
                setOpen(false);
            }
        };

        window.addEventListener("customizer-panel-open", handler);
        return () => window.removeEventListener("customizer-panel-open", handler);
    }, []);

    useEffect(() => {
        if (!open) return;

        window.dispatchEvent(
            new CustomEvent("customizer-panel-open", { detail: "layout" })
        );
    }, [open]);

    const handleToggle = useCallback(() => {
        setOpen((prev) => !prev);
    }, []);

    const applyDesign = useCallback((id: string) => {
        if (id === "default") {
            localStorage.removeItem(STORAGE_KEY);
        } else {
            localStorage.setItem(STORAGE_KEY, id);
        }
        setActiveId(id);
        window.dispatchEvent(new Event("layout-design-changed"));
    }, []);

    const handleReset = useCallback(() => {
        localStorage.removeItem(STORAGE_KEY);
        setActiveId("default");
        window.dispatchEvent(new Event("layout-design-changed"));
    }, []);

    if (!pathname.startsWith("/edition")) {
        return null;
    }

    return (
        <>
            <button
                className="layout-customizer-toggle"
                onClick={handleToggle}
                title="Layout Design"
                aria-label="Toggle layout design picker"
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
                    <rect x="3" y="3" width="8" height="8" rx="1" />
                    <rect x="13" y="3" width="8" height="8" rx="1" />
                    <rect x="3" y="13" width="8" height="8" rx="1" />
                    <rect x="13" y="13" width="8" height="8" rx="1" />
                </svg>
            </button>

            {open && (
                <div className="layout-customizer-panel">
                    <div className="layout-customizer-header">
                        <span className="layout-customizer-title">Layout</span>
                        <button className="layout-customizer-reset" onClick={handleReset}>
                            Reset
                        </button>
                    </div>

                    <div className="layout-customizer-scroll">
                        {LAYOUT_DESIGNS.map((design) => (
                            <button
                                key={design.id}
                                className={`layout-customizer-preset${activeId === design.id ? " active" : ""}`}
                                onClick={() => applyDesign(design.id)}
                            >
                                <span className="layout-preset-name">{design.name}</span>
                                <span className="layout-preset-desc">{design.description}</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </>
    );
}
