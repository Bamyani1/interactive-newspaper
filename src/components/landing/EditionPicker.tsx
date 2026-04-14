"use client";

import React, { useState, useMemo, useCallback } from "react";
/* ─── Types ────────────────────────────────── */

interface EditionPickerProps {
    editions: string[];               // "YYYY-MM-DD" sorted earliest-first
    selectedEdition: string | null;   // currently selected date
    onSelect: (date: string) => void;
    onOpenChange?: (isOpen: boolean) => void;
}

interface DecadeGroup {
    decade: string;   // e.g. "1960s"
    prefix: string;   // e.g. "196"
    editions: string[];
}

/* ─── Utilities ────────────────────────────── */

function groupEditionsByDecade(editions: string[]): DecadeGroup[] {
    const map = new Map<string, string[]>();
    for (const date of editions) {
        const prefix = date.slice(0, 3);
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

function formatEditionDate(dateStr: string): string {
    const d = new Date(dateStr + "T12:00:00");
    return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
    });
}

function formatWeekday(dateStr: string): string {
    const d = new Date(dateStr + "T12:00:00");
    return d.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
}

function getDecadePrefix(dateStr: string): string {
    return dateStr.slice(0, 3);
}

/* ─── Component ────────────────────────────── */

export function EditionPicker({
    editions,
    selectedEdition,
    onSelect,
    onOpenChange,
}: EditionPickerProps) {
    const [isOpen, setIsOpen] = useState(false);
    const groups = useMemo(() => groupEditionsByDecade(editions), [editions]);

    // Default to the decade of the selected edition, or the first decade
    const selectedDecadePrefix = selectedEdition ? getDecadePrefix(selectedEdition) : null;
    const [activeDecade, setActiveDecade] = useState<string | null>(null);

    // Resolve which decade to show in the picker
    const currentDecade = activeDecade ?? selectedDecadePrefix ?? (groups[0]?.prefix ?? null);
    const activeGroup = useMemo(
        () => groups.find((g) => g.prefix === currentDecade) ?? null,
        [groups, currentDecade],
    );

    const openPicker = useCallback(() => {
        // Start at the selected edition's decade
        if (selectedDecadePrefix) {
            setActiveDecade(selectedDecadePrefix);
        } else if (groups.length > 0) {
            setActiveDecade(groups[0].prefix);
        }
        setIsOpen(true);
        onOpenChange?.(true);
    }, [selectedDecadePrefix, groups, onOpenChange]);

    const closePicker = useCallback(() => {
        setIsOpen(false);
        onOpenChange?.(false);
    }, [onOpenChange]);

    const handleSelect = useCallback((date: string) => {
        onSelect(date);
        closePicker();
    }, [onSelect, closePicker]);

    /* ── Empty ──────────────── */
    if (editions.length === 0) {
        return (
            <div className="ep-container">
                <p className="ep-empty">No editions available</p>
            </div>
        );
    }

    /* ── Closed state: editorial date block ── */
    if (!isOpen) {
        return (
            <div className="ep-container ep-container--closed">
                <button
                    type="button"
                    className="ep-closed-btn"
                    onClick={openPicker}
                    aria-label={`Selected edition: ${selectedEdition ? formatEditionDate(selectedEdition) : "none"}. Click to change.`}
                >
                    <span className="ep-closed-label">Selected Edition</span>
                    <span className="ep-closed-rule" aria-hidden="true" />
                    <span className="ep-closed-date">
                        {selectedEdition ? formatEditionDate(selectedEdition) : "Pick Edition"}
                    </span>
                    <span className="ep-closed-rule" aria-hidden="true" />
                    <span className="ep-closed-change">Change ›</span>
                </button>
            </div>
        );
    }

    /* ── Open state: Decade tabs + date list ── */
    return (
        <div className="ep-container ep-container--open">
            {/* Decade tabs */}
            <div className="ep-decade-tabs" role="tablist" aria-label="Select decade">
                {groups.map((group) => (
                    <button
                        key={group.prefix}
                        type="button"
                        role="tab"
                        aria-selected={currentDecade === group.prefix}
                        className={`ep-decade-tab ${currentDecade === group.prefix ? "ep-decade-tab--active" : ""}`}
                        onClick={() => setActiveDecade(group.prefix)}
                    >
                        {group.decade}
                    </button>
                ))}
            </div>

            {/* Edition list for selected decade */}
            {activeGroup && (
                <div className="ep-date-list" role="listbox" aria-label={`Editions from the ${activeGroup.decade}`}>
                    {activeGroup.editions.map((date) => {
                        const isSelected = selectedEdition === date;
                        return (
                            <button
                                key={date}
                                type="button"
                                role="option"
                                aria-selected={isSelected}
                                className={`ep-date-item ${isSelected ? "ep-date-item--selected" : ""}`}
                                onClick={() => handleSelect(date)}
                            >
                                <span className="ep-date-item-date">
                                    {formatEditionDate(date)}
                                    {date === "1960-01-13" && " (golden)"}
                                </span>
                                <span className="ep-date-item-weekday">
                                    {formatWeekday(date)}
                                </span>
                            </button>
                        );
                    })}
                </div>
            )}

            {/* Close */}
            <button
                type="button"
                className="ep-close-btn"
                onClick={closePicker}
            >
                ✕ Close
            </button>
        </div>
    );
}
