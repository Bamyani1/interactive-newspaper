"use client";

import React from "react";
import { useHistoricalWeather } from "@/features/weather";
import { SidebarPlayer } from "@/features/music-player";
import { motion } from "framer-motion";
import { fadeUp, TRANSITIONS } from "@/shared/motion/motionTokens";

interface ContextSidebarProps {
    currentDate: string | null;
}

export const ContextSidebar: React.FC<ContextSidebarProps> = ({ currentDate }) => {
    const { record, isLoading } = useHistoricalWeather(currentDate ?? null);
    const itemVariants = fadeUp(14);
    const sidebarVariants = {
        hidden: { opacity: 0, x: 16 },
        show: {
            opacity: 1,
            x: 0,
            transition: { ...TRANSITIONS.base, staggerChildren: 0.1, delayChildren: 0.1 },
        },
    };

    const highF = record?.tmax_c != null ? Math.round(record.tmax_c * 9 / 5 + 32) : null;
    const lowF = record?.tmin_c != null ? Math.round(record.tmin_c * 9 / 5 + 32) : null;
    const formattedDate = currentDate
        ? new Intl.DateTimeFormat("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
              year: "numeric",
          })
              .format(new Date(currentDate + "T12:00:00"))
              .toUpperCase()
        : null;

    return (
        <motion.aside
            className="edition-sidebar-surface h-full overflow-hidden p-6"
            variants={sidebarVariants}
            initial="hidden"
            animate="show"
        >

            {currentDate && (
                <motion.div className="mb-8" variants={itemVariants} transition={TRANSITIONS.base}>
                    <h3
                        className="uppercase font-mono text-[10px] tracking-[0.2em] mb-3 border-b border-dashed pb-1"
                        style={{ borderColor: "var(--stroke-accent-soft)" }}
                    >
                        Weather Report
                    </h3>

                    <div
                        className="border p-4"
                        style={{
                            borderColor: "var(--color-border-default)",
                            background: "color-mix(in srgb, var(--color-bg-secondary) 50%, transparent)",
                        }}
                    >
                        {isLoading ? (
                            <p className="font-mono text-[10px] tracking-widest uppercase animate-pulse opacity-70">
                                Receiving weather data...
                            </p>
                        ) : highF != null && lowF != null ? (
                            <>
                                <p className="font-mono text-[10px] tracking-[0.15em] uppercase opacity-60 mb-3">
                                    Delaware, Ohio
                                </p>

                                <div className="flex items-baseline gap-2 mb-1">
                                    <span className="font-header text-4xl leading-none">{highF}°</span>
                                    <span className="font-header text-2xl leading-none opacity-60">/ {lowF}°</span>
                                </div>
                                <div className="flex gap-4 mb-1">
                                    <span className="font-mono text-[9px] tracking-[0.2em] uppercase opacity-50">High</span>
                                    <span className="font-mono text-[9px] tracking-[0.2em] uppercase opacity-50">Low</span>
                                </div>

                                <div
                                    className="border-t border-dashed my-3"
                                    style={{ borderColor: "var(--color-border-default)" }}
                                />
                                <p className="font-mono text-[10px] tracking-[0.15em] uppercase opacity-60">
                                    {formattedDate}
                                </p>

                                {record?.is_estimated && (
                                    <p className="font-mono text-[9px] tracking-[0.15em] uppercase opacity-50 mt-2">
                                        * Estimated
                                    </p>
                                )}
                            </>
                        ) : (
                            <p className="font-mono text-[10px] tracking-widest uppercase opacity-50">
                                Weather data unavailable
                            </p>
                        )}
                    </div>
                </motion.div>
            )}

            <motion.div variants={itemVariants} transition={TRANSITIONS.base}>
                <SidebarPlayer currentDate={currentDate} />
            </motion.div>

        </motion.aside>
    );
};
