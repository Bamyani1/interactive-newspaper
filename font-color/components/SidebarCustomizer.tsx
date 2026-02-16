"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { SIDEBAR_DESIGNS } from "../data/sidebarDesigns";

const STORAGE_KEY = "tts-sidebar-design";

export default function SidebarCustomizer() {
    const pathname = usePathname();
    const [open, setOpen] = useState(false);
    const [activeId, setActiveId] = useState(() => {
        if (typeof window === "undefined") return "default";
        const saved = localStorage.getItem(STORAGE_KEY);
        return SIDEBAR_DESIGNS.some((d) => d.id === saved) ? saved! : "default";
    });

    useEffect(() => {
        const handler = (e: Event) => {
            if ((e as CustomEvent).detail !== "sidebar") {
                setOpen(false);
            }
        };

        window.addEventListener("customizer-panel-open", handler);
        return () => window.removeEventListener("customizer-panel-open", handler);
    }, []);

    useEffect(() => {
        if (!open) return;

        window.dispatchEvent(
            new CustomEvent("customizer-panel-open", { detail: "sidebar" })
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
        window.dispatchEvent(new Event("sidebar-design-changed"));
    }, []);

    const handleReset = useCallback(() => {
        localStorage.removeItem(STORAGE_KEY);
        setActiveId("default");
        window.dispatchEvent(new Event("sidebar-design-changed"));
    }, []);

    if (!pathname.startsWith("/edition")) {
        return null;
    }

    return (
        <>
            <button
                className="sidebar-customizer-toggle"
                onClick={handleToggle}
                title="Sidebar Design"
                aria-label="Toggle sidebar design picker"
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
                    <rect x="3" y="3" width="4" height="18" rx="1" />
                    <line x1="11" y1="6" x2="21" y2="6" />
                    <line x1="11" y1="12" x2="21" y2="12" />
                    <line x1="11" y1="18" x2="21" y2="18" />
                </svg>
            </button>

            {open && (
                <div className="sidebar-customizer-panel">
                    <div className="sidebar-customizer-header">
                        <span className="sidebar-customizer-title">Sidebar</span>
                        <button className="sidebar-customizer-reset" onClick={handleReset}>
                            Reset
                        </button>
                    </div>

                    <div className="sidebar-customizer-scroll">
                        {SIDEBAR_DESIGNS.map((design) => (
                            <button
                                key={design.id}
                                className={`sidebar-customizer-preset${activeId === design.id ? " active" : ""}`}
                                onClick={() => applyDesign(design.id)}
                            >
                                <span className="sidebar-preset-name">{design.name}</span>
                                <span className="sidebar-preset-desc">{design.description}</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </>
    );
}
