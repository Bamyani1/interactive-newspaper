"use client";

import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ChevronRight } from "lucide-react";
import type { SectionId } from "@/src/types";
import { staggerContainer } from "@/shared/motion/motionTokens";
import { BroadsheetCompact } from "./variants/BroadsheetCompact";
import { FleuronClassic } from "./variants/FleuronClassic";
import { DispatchMono } from "./variants/DispatchMono";
import { SpecimenCentered } from "./variants/SpecimenCentered";
import { LedgerRuled } from "./variants/LedgerRuled";
import "./variants/variants.css";

export interface NavigationSidebarProps {
    sections: {
        id: SectionId;
        label: string;
        count?: number;
    }[];
    activeSection: SectionId;
    onSelect: (section: SectionId) => void;
}

const STORAGE_KEY = "tts-sidebar-design";

const VARIANT_MAP: Record<string, React.FC<NavigationSidebarProps>> = {
    default: FleuronClassic,
    legacy: DefaultSidebar,
    broadsheet: BroadsheetCompact,
    dispatch: DispatchMono,
    specimen: SpecimenCentered,
    ledger: LedgerRuled,
};

export const NavigationSidebar: React.FC<NavigationSidebarProps> = (props) => {
    const [designId, setDesignId] = useState(() => {
        if (typeof window === "undefined") return "default";
        return localStorage.getItem(STORAGE_KEY) || "default";
    });

    useEffect(() => {
        const handler = () => {
            setDesignId(localStorage.getItem(STORAGE_KEY) || "default");
        };
        window.addEventListener("sidebar-design-changed", handler);
        return () => window.removeEventListener("sidebar-design-changed", handler);
    }, []);

    const Variant = VARIANT_MAP[designId] || FleuronClassic;
    return <Variant {...props} />;
};

/* ── Default sidebar (original implementation) ─────────────── */

function DefaultSidebar({ sections, activeSection, onSelect }: NavigationSidebarProps) {
    const containerVariants = staggerContainer(0.06, 0.08);

    return (
        <motion.aside
            className="edition-sidebar-surface h-full min-h-0 overflow-y-auto p-6 hidden md:block"
            initial="hidden"
            animate="show"
        >
            <motion.nav className="flex flex-col gap-1" variants={containerVariants}>
                <h3
                    className="font-mono text-xs uppercase tracking-widest mb-4 pb-2 border-b border-dashed"
                    style={{ borderColor: "var(--stroke-accent-soft)", color: "var(--color-accent)" }}
                >
                    Sections
                </h3>
                {sections.map((section) => {
                    const isActive = activeSection === section.id;
                    return (
                        <motion.button
                            key={section.id}
                            onClick={() => onSelect(section.id)}
                            className={`
                                group relative text-left py-2.5 px-3 transition-all
                                font-header text-lg flex items-center justify-between gap-3
                                border-l-2
                                ${isActive
                                    ? "border-l-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]"
                                    : "border-l-transparent hover:border-l-[var(--color-accent)]/50 hover:bg-[var(--color-accent)]/5"
                                }
                            `}
                            aria-current={isActive ? "true" : undefined}
                        >
                            <span className={isActive ? "font-semibold" : ""}>{section.label}</span>
                            {isActive && (
                                <ChevronRight className="w-4 h-4 text-[var(--color-accent)]" />
                            )}
                            {section.count !== undefined && section.count > 0 && !isActive && (
                                <span className="text-xs font-mono opacity-40">
                                    {section.count}
                                </span>
                            )}
                        </motion.button>
                    );
                })}
            </motion.nav>
        </motion.aside>
    );
}
