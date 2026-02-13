"use client";

import React from "react";
import { motion } from "framer-motion";
import { ChevronRight } from "lucide-react";
import type { SectionId } from "@/src/types";
import { fadeLeft, staggerContainer, TRANSITIONS } from "@/shared/motion/motionTokens";

interface NavigationSidebarProps {
    sections: {
        id: SectionId;
        label: string;
        count?: number;
    }[];
    activeSection: SectionId;
    onSelect: (section: SectionId) => void;
}

export const NavigationSidebar: React.FC<NavigationSidebarProps> = ({
    sections,
    activeSection,
    onSelect,
}) => {
    const containerVariants = staggerContainer(0.06, 0.08);
    const itemVariants = fadeLeft(12);

    return (
        <motion.aside
            className="h-full p-6 bg-[var(--color-bg-primary)]/50 backdrop-blur-sm hidden md:block"
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
};
