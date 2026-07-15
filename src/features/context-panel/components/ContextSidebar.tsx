"use client";

import React, { useSyncExternalStore } from "react";
import { useHistoricalWeather } from "@/features/weather";
import { SidebarPlayer } from "@/features/music-player";

const DESKTOP_CONTEXT_QUERY = "(min-width: 1024px)";

function subscribeToDesktopContext(onChange: () => void) {
    const mediaQuery = window.matchMedia(DESKTOP_CONTEXT_QUERY);
    mediaQuery.addEventListener("change", onChange);
    return () => mediaQuery.removeEventListener("change", onChange);
}

function isDesktopContextVisible() {
    return window.matchMedia(DESKTOP_CONTEXT_QUERY).matches;
}

interface ContextSidebarProps {
    currentDate: string | null;
}

const ContextSidebarContent: React.FC<ContextSidebarProps> = ({ currentDate }) => {
    const { record, isLoading, error } = useHistoricalWeather(currentDate ?? null);

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
        <aside data-context-sidebar className="edition-sidebar-surface h-full overflow-hidden p-6">

            {currentDate && (
                <div className="mb-8">
                    <h3 className="uppercase font-mono text-xs tracking-label-md mb-3 border-b border-dashed border-[var(--stroke-accent-soft)] pb-1">
                        Weather Report
                    </h3>

                    <div className="border border-[var(--color-border-default)] bg-[color-mix(in_srgb,var(--color-bg-secondary)_50%,transparent)] p-4">
                        {isLoading ? (
                            <p className="font-mono text-xs tracking-label-md uppercase animate-pulse text-[var(--color-text-secondary)] motion-reduce:animate-none">
                                Receiving weather data...
                            </p>
                        ) : error ? (
                            <p className="font-mono text-xs tracking-label-md uppercase text-[var(--color-text-secondary)]">
                                Unable to load weather data right now
                            </p>
                        ) : highF != null && lowF != null ? (
                            <>
                                <p className="font-mono text-xs tracking-label-md uppercase text-[var(--color-text-secondary)] mb-3">
                                    Delaware, Ohio
                                </p>

                                <div className="flex items-baseline gap-2 mb-1">
                                    <span className="font-header text-4xl leading-none">{highF}°</span>
                                    <span className="font-header text-2xl leading-none text-[var(--color-text-secondary)]">/ {lowF}°</span>
                                </div>
                                <div className="flex gap-4 mb-1">
                                    <span className="font-mono text-xs tracking-label-md uppercase text-[var(--color-text-secondary)]">High</span>
                                    <span className="font-mono text-xs tracking-label-md uppercase text-[var(--color-text-secondary)]">Low</span>
                                </div>

                                <div className="border-t border-dashed border-[var(--color-border-default)] my-3" />
                                <p className="font-mono text-xs tracking-label-md uppercase text-[var(--color-text-secondary)]">
                                    {formattedDate}
                                </p>

                                {record?.is_estimated && (
                                    <p className="font-mono text-xs tracking-label-md uppercase text-[var(--color-text-secondary)] mt-2">
                                        * Estimated
                                    </p>
                                )}
                            </>
                        ) : (
                            <p className="font-mono text-xs tracking-label-md uppercase text-[var(--color-text-secondary)]">
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

export const ContextSidebar: React.FC<ContextSidebarProps> = (props) => {
    const isDesktop = useSyncExternalStore(
        subscribeToDesktopContext,
        isDesktopContextVisible,
        () => false,
    );

    return isDesktop ? <ContextSidebarContent {...props} /> : null;
};
