"use client";

import React from "react";
import { useHistoricalWeather } from "@/features/weather";
import { SidebarPlayer } from "@/features/music-player";

interface ContextSidebarProps {
    currentDate: string | null;
}

export const ContextSidebar: React.FC<ContextSidebarProps> = ({ currentDate }) => {
    const { record, isLoading } = useHistoricalWeather(currentDate ?? null);

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
        <aside className="edition-sidebar-surface h-full overflow-hidden p-6">

            {currentDate && (
                <div className="mb-8">
                    <h3 className="uppercase font-mono text-xs tracking-label-md mb-3 border-b border-dashed border-[var(--stroke-accent-soft)] pb-1">
                        Weather Report
                    </h3>

                    <div className="border border-[var(--color-border-default)] bg-[color-mix(in_srgb,var(--color-bg-secondary)_50%,transparent)] p-4">
                        {isLoading ? (
                            <p className="font-mono text-xs tracking-label-md uppercase animate-pulse opacity-70">
                                Receiving weather data...
                            </p>
                        ) : highF != null && lowF != null ? (
                            <>
                                <p className="font-mono text-xs tracking-label-md uppercase opacity-60 mb-3">
                                    Delaware, Ohio
                                </p>

                                <div className="flex items-baseline gap-2 mb-1">
                                    <span className="font-header text-4xl leading-none">{highF}°</span>
                                    <span className="font-header text-2xl leading-none opacity-60">/ {lowF}°</span>
                                </div>
                                <div className="flex gap-4 mb-1">
                                    <span className="font-mono text-xs tracking-label-md uppercase opacity-50">High</span>
                                    <span className="font-mono text-xs tracking-label-md uppercase opacity-50">Low</span>
                                </div>

                                <div className="border-t border-dashed border-[var(--color-border-default)] my-3" />
                                <p className="font-mono text-xs tracking-label-md uppercase opacity-60">
                                    {formattedDate}
                                </p>

                                {record?.is_estimated && (
                                    <p className="font-mono text-xs tracking-label-md uppercase opacity-50 mt-2">
                                        * Estimated
                                    </p>
                                )}
                            </>
                        ) : (
                            <p className="font-mono text-xs tracking-label-md uppercase opacity-50">
                                Weather data unavailable
                            </p>
                        )}
                    </div>
                </div>
            )}

            <div>
                <SidebarPlayer currentDate={currentDate} />
            </div>

        </aside>
    );
};
