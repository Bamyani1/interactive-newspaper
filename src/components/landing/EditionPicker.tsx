"use client";

import React, { useCallback, useId, useMemo, useRef, useState } from "react";
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
    const triggerRef = useRef<HTMLButtonElement>(null);
    const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
    const optionRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
    const tabSetId = useId();

    // Default to the decade of the selected edition, or the first decade
    const selectedDecadePrefix = selectedEdition ? getDecadePrefix(selectedEdition) : null;
    const [activeDecade, setActiveDecade] = useState<string | null>(null);
    const [activeDate, setActiveDate] = useState<string | null>(selectedEdition);

    // Resolve which decade to show in the picker
    const currentDecade = activeDecade ?? selectedDecadePrefix ?? (groups[0]?.prefix ?? null);

    const openPicker = useCallback(() => {
        // Start at the selected edition's decade
        const targetDecade = selectedDecadePrefix ?? groups[0]?.prefix ?? null;
        if (!targetDecade) return;
        setActiveDecade(targetDecade);
        const targetGroup = groups.find((group) => group.prefix === targetDecade);
        setActiveDate(
            selectedEdition && targetGroup?.editions.includes(selectedEdition)
                ? selectedEdition
                : targetGroup?.editions[0] ?? null,
        );
        setIsOpen(true);
        onOpenChange?.(true);
        window.requestAnimationFrame(() => tabRefs.current.get(targetDecade)?.focus());
    }, [selectedDecadePrefix, groups, onOpenChange, selectedEdition]);

    const closePicker = useCallback((returnFocus = true) => {
        setIsOpen(false);
        onOpenChange?.(false);
        if (returnFocus) {
            window.requestAnimationFrame(() => triggerRef.current?.focus());
        }
    }, [onOpenChange]);

    const handleSelect = useCallback((date: string) => {
        onSelect(date);
        closePicker();
    }, [onSelect, closePicker]);

    const activateDecade = useCallback((prefix: string) => {
        const group = groups.find((candidate) => candidate.prefix === prefix);
        setActiveDecade(prefix);
        setActiveDate(
            selectedEdition && group?.editions.includes(selectedEdition)
                ? selectedEdition
                : group?.editions[0] ?? null,
        );
    }, [groups, selectedEdition]);

    const handleTabKeyDown = (
        event: React.KeyboardEvent<HTMLButtonElement>,
        prefix: string,
    ) => {
        const currentIndex = groups.findIndex((group) => group.prefix === prefix);
        let nextIndex: number | null = null;
        if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % groups.length;
        else if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + groups.length) % groups.length;
        else if (event.key === "Home") nextIndex = 0;
        else if (event.key === "End") nextIndex = groups.length - 1;
        if (nextIndex === null) return;
        event.preventDefault();
        const next = groups[nextIndex];
        activateDecade(next.prefix);
        tabRefs.current.get(next.prefix)?.focus();
    };

    const handleOptionKeyDown = (
        event: React.KeyboardEvent<HTMLButtonElement>,
        date: string,
        group: DecadeGroup,
    ) => {
        const currentIndex = group.editions.indexOf(date);
        let nextIndex: number | null = null;
        if (event.key === "ArrowDown") nextIndex = (currentIndex + 1) % group.editions.length;
        else if (event.key === "ArrowUp") nextIndex = (currentIndex - 1 + group.editions.length) % group.editions.length;
        else if (event.key === "Home") nextIndex = 0;
        else if (event.key === "End") nextIndex = group.editions.length - 1;
        if (nextIndex === null) return;
        event.preventDefault();
        const nextDate = group.editions[nextIndex];
        setActiveDate(nextDate);
        optionRefs.current.get(nextDate)?.focus();
    };

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
                    ref={triggerRef}
                    type="button"
                    className="ep-closed-btn"
                    onClick={openPicker}
                    aria-label={`Selected edition: ${selectedEdition ? formatEditionDate(selectedEdition) : "none"}. Activate to change.`}
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
        <div
            className="ep-container ep-container--open"
            onKeyDown={(event) => {
                if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    closePicker();
                }
            }}
        >
            {/* Decade tabs */}
            <div className="ep-decade-tabs" role="tablist" aria-label="Select decade">
                {groups.map((group) => (
                    <button
                        key={group.prefix}
                        id={`${tabSetId}-tab-${group.prefix}`}
                        type="button"
                        role="tab"
                        aria-selected={currentDecade === group.prefix}
                        aria-controls={`${tabSetId}-panel-${group.prefix}`}
                        tabIndex={currentDecade === group.prefix ? 0 : -1}
                        ref={(node) => {
                            if (node) tabRefs.current.set(group.prefix, node);
                            else tabRefs.current.delete(group.prefix);
                        }}
                        className={`ep-decade-tab ${currentDecade === group.prefix ? "ep-decade-tab--active" : ""}`}
                        onClick={() => activateDecade(group.prefix)}
                        onKeyDown={(event) => handleTabKeyDown(event, group.prefix)}
                    >
                        {group.decade}
                    </button>
                ))}
            </div>

            {/* Edition list for selected decade */}
            {groups.map((group) => {
                const isActive = currentDecade === group.prefix;
                return (
                    <div
                        key={group.prefix}
                        id={`${tabSetId}-panel-${group.prefix}`}
                        role="tabpanel"
                        aria-labelledby={`${tabSetId}-tab-${group.prefix}`}
                        hidden={!isActive}
                    >
                        <div
                            className="ep-date-list"
                            role="listbox"
                            aria-label={`Editions from the ${group.decade}`}
                        >
                            {group.editions.map((date) => {
                                const isSelected = selectedEdition === date;
                                const isActiveOption =
                                    isActive &&
                                    (activeDate ?? group.editions[0]) === date;
                                return (
                                    <button
                                        key={date}
                                        type="button"
                                        role="option"
                                        aria-selected={isSelected}
                                        tabIndex={isActiveOption ? 0 : -1}
                                        ref={(node) => {
                                            if (node) optionRefs.current.set(date, node);
                                            else optionRefs.current.delete(date);
                                        }}
                                        className={`ep-date-item ${isSelected ? "ep-date-item--selected" : ""}`}
                                        onClick={() => handleSelect(date)}
                                        onFocus={() => setActiveDate(date)}
                                        onKeyDown={(event) =>
                                            handleOptionKeyDown(event, date, group)
                                        }
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
                    </div>
                );
            })}

            {/* Close */}
            <button
                type="button"
                className="ep-close-btn"
                onClick={() => closePicker()}
            >
                ✕ Close
            </button>
        </div>
    );
}
