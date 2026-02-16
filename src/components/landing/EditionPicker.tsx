"use client";

import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";

/* ─── Types ────────────────────────────────── */

interface EditionPickerProps {
    editions: string[];               // "YYYY-MM-DD" sorted earliest-first
    selectedEdition: string | null;   // currently selected date
    onSelect: (date: string) => void;
    isLoading?: boolean;
    onOpenChange?: (isOpen: boolean) => void;
}

interface DecadeGroup {
    decade: string;   // e.g. "1980s"
    prefix: string;   // e.g. "198"
    editions: string[];
}

/* ─── Utilities ────────────────────────────── */

function groupEditionsByDecade(editions: string[]): DecadeGroup[] {
    const map = new Map<string, string[]>();
    for (const date of editions) {
        const prefix = date.slice(0, 3); // "198" from "1988-04-13"
        if (!map.has(prefix)) map.set(prefix, []);
        map.get(prefix)!.push(date);
    }
    return Array.from(map.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([prefix, dates]) => ({
            decade: `${prefix}0s`,
            prefix,
            editions: dates.sort(),
        }));
}

function formatEditionLabel(dateStr: string): string {
    const date = new Date(dateStr + "T12:00:00");
    return date.toLocaleDateString("en-US", {
        month: "short",
        day: "2-digit",
        year: "numeric",
    });
}

function formatWeekday(dateStr: string): string {
    const date = new Date(dateStr + "T12:00:00");
    return date.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
}

function getDecadePrefix(dateStr: string): string {
    return dateStr.slice(0, 3);
}

/* ─── Component ────────────────────────────── */

export function EditionPicker({
    editions,
    selectedEdition,
    onSelect,
    isLoading = false,
    onOpenChange,
}: EditionPickerProps) {
    const groups = useMemo(() => groupEditionsByDecade(editions), [editions]);

    // null = decade view, string = edition view for that decade prefix
    const [activeDecade, setActiveDecade] = useState<string | null>(null);

    useEffect(() => {
        onOpenChange?.(activeDecade !== null);
    }, [activeDecade, onOpenChange]);

    // Which decade holds the current selection?
    const selectedDecadePrefix = selectedEdition ? getDecadePrefix(selectedEdition) : null;

    // Find the active group for step 2
    const activeGroup = useMemo(
        () => groups.find((g) => g.prefix === activeDecade) ?? null,
        [groups, activeDecade],
    );

    // Refs for keyboard navigation
    const decadeRefs = useRef<(HTMLButtonElement | null)[]>([]);
    const editionRefs = useRef<(HTMLButtonElement | null)[]>([]);

    // Reset edition refs when switching decades
    useEffect(() => {
        editionRefs.current = [];
    }, [activeDecade]);

    // Keyboard: arrow keys in decade list
    const handleDecadeKeyDown = useCallback(
        (e: React.KeyboardEvent, index: number) => {
            let next = index;
            if (e.key === "ArrowDown") next = Math.min(index + 1, groups.length - 1);
            else if (e.key === "ArrowUp") next = Math.max(index - 1, 0);
            else if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setActiveDecade(groups[index].prefix);
                return;
            } else return;
            e.preventDefault();
            decadeRefs.current[next]?.focus();
        },
        [groups],
    );

    // Keyboard: arrow keys in edition list, Escape to go back
    const handleEditionKeyDown = useCallback(
        (e: React.KeyboardEvent, index: number, editionCount: number) => {
            if (e.key === "Escape") {
                e.preventDefault();
                setActiveDecade(null);
                // Focus the decade that was active
                const decadeIndex = groups.findIndex((g) => g.prefix === activeDecade);
                requestAnimationFrame(() => {
                    decadeRefs.current[decadeIndex]?.focus();
                });
                return;
            }
            let next = index;
            if (e.key === "ArrowDown") next = Math.min(index + 1, editionCount - 1);
            else if (e.key === "ArrowUp") next = Math.max(index - 1, 0);
            else return;
            e.preventDefault();
            editionRefs.current[next]?.focus();
        },
        [groups, activeDecade],
    );

    /* ── Loading ────────────── */
    if (isLoading && editions.length === 0) {
        return (
            <div className="ep-container">
                <p className="ep-heading">Select an Edition</p>
                <p className="ep-loading">Loading archive...</p>
            </div>
        );
    }

    /* ── Empty ──────────────── */
    if (!isLoading && editions.length === 0) {
        return (
            <div className="ep-container">
                <p className="ep-heading">Select an Edition</p>
                <p className="ep-empty">No editions available</p>
            </div>
        );
    }

    /* ── Main ──────────────── */
    return (
        <div className="ep-container">
            {/* Decade view (hidden when edition list is open) */}
            {!activeGroup && (
                <>
                    <p className="ep-heading">Select an Edition</p>
                    <div
                        role="listbox"
                        aria-label={`${groups.length} decade${groups.length !== 1 ? "s" : ""} available`}
                        className="ep-edition-list"
                    >
                        {groups.map((group, i) => {
                            const hasSelection = selectedDecadePrefix === group.prefix;
                            return (
                                <button
                                    key={group.prefix}
                                    ref={(el) => { decadeRefs.current[i] = el; }}
                                    type="button"
                                    role="option"
                                    aria-selected={hasSelection}
                                    className="ep-edition-card"
                                    onClick={() => setActiveDecade(group.prefix)}
                                    onKeyDown={(e) => handleDecadeKeyDown(e, i)}
                                >
                                    {hasSelection && selectedEdition ? (
                                        <span className="ep-edition-date ep-edition-date--centered">Selected Edition {selectedEdition}</span>
                                    ) : (
                                        <>
                                            <span className="ep-edition-date">{group.decade}</span>
                                            <span className="ep-edition-weekday">
                                                {group.editions.length} edition{group.editions.length !== 1 ? "s" : ""}
                                            </span>
                                        </>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </>
            )}

            {/* Edition view (replaces decade view) */}
            {activeGroup && (
                <div className="ep-popup">
                    <button
                        type="button"
                        className="ep-back-btn"
                        aria-label="Back to decade list"
                        onClick={() => setActiveDecade(null)}
                    >
                        <span className="ep-back-arrow">&larr;</span>
                        <span className="ep-back-label">{activeGroup.decade}</span>
                        <span className="ep-back-count">
                            {activeGroup.editions.length} edition{activeGroup.editions.length !== 1 ? "s" : ""}
                        </span>
                    </button>
                    <div
                        role="listbox"
                        aria-label={`Editions from the ${activeGroup.decade}`}
                        className="ep-edition-list"
                    >
                        {activeGroup.editions.map((date, i) => (
                            <button
                                key={date}
                                ref={(el) => { editionRefs.current[i] = el; }}
                                type="button"
                                role="option"
                                aria-selected={selectedEdition === date}
                                className="ep-edition-card"
                                onClick={() => onSelect(date)}
                                onKeyDown={(e) => handleEditionKeyDown(e, i, activeGroup.editions.length)}
                            >
                                <span className="ep-edition-date">
                                    {formatEditionLabel(date)}
                                </span>
                                <span className="ep-edition-weekday">
                                    {formatWeekday(date)}
                                </span>
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
