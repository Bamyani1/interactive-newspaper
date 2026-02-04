"use client";

import React from "react";
import { useArchive } from "@/features/archive";
import { getClosestContext } from "@/features/news-feed";
import { CloudSun, History } from "lucide-react";
import { SidebarPlayer } from "@/features/music-player";
import { motion } from "framer-motion";
import { fadeUp, TRANSITIONS } from "@/shared/motion/motionTokens";

export const ContextSidebar = () => {
    const { currentDate } = useArchive();
    const context = getClosestContext(currentDate);
    const itemVariants = fadeUp(14);
    const sidebarVariants = {
        hidden: { opacity: 0, x: 16 },
        show: {
            opacity: 1,
            x: 0,
            transition: { ...TRANSITIONS.base, staggerChildren: 0.1, delayChildren: 0.1 },
        },
    };

    return (
        <motion.aside
            className="h-full p-6 border-l bg-[var(--color-bg-primary)]/50 backdrop-blur-sm"
            style={{ borderColor: "var(--stroke-accent-soft)" }}
            variants={sidebarVariants}
            initial="hidden"
            animate="show"
        >

            {/* Weather Widget */}
            <motion.div
                className="mb-8 p-4 border text-center"
                style={{ borderColor: "var(--stroke-accent-soft)" }}
                variants={itemVariants}
                transition={TRANSITIONS.base}
            >
                <h3
                    className="uppercase font-mono text-xs tracking-widest mb-2 border-b border-dashed pb-1"
                    style={{ borderColor: "var(--stroke-accent-soft)" }}
                >
                    Weather Forecast
                </h3>
                <div className="flex flex-col items-center gap-2">
                    <CloudSun className="w-8 h-8" />
                    <span className="font-header text-xl">{context.weather}</span>
                </div>
            </motion.div>

            {/* This Day in History */}
            {context.history?.length > 0 && (
                <motion.div className="mb-8" variants={itemVariants} transition={TRANSITIONS.base}>
                    <h3
                        className="flex items-center gap-2 uppercase font-mono text-xs tracking-widest mb-3 border-b border-dashed pb-1"
                        style={{ borderColor: "var(--stroke-accent-soft)" }}
                    >
                        <History size={14} /> This Day in History
                    </h3>
                    <ul className="space-y-2 text-sm leading-relaxed list-none pl-0">
                        {context.history.map((item: string, idx: number) => (
                            <li key={idx}>{item}</li>
                        ))}
                    </ul>
                </motion.div>
            )}

            <motion.div
                className="pt-6 mt-6 border-t"
                style={{ borderColor: "var(--stroke-accent-soft)" }}
                variants={itemVariants}
                transition={TRANSITIONS.base}
            >
                <SidebarPlayer />
            </motion.div>

        </motion.aside>
    );
};
