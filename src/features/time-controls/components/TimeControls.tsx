"use client";

import React, { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { Calendar, ChevronDown, MessageCircleQuestion, Search } from "lucide-react";
import { ThemeModeToggle } from "@/features/theme";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useArchive } from "@/features/archive";
import { markExplicitEditionNavigation } from "@/shared/navigation/editionNavigation";
import { TRANSITIONS } from "@/shared/motion/motionTokens";

const formatDisplayDate = (dateStr: string): string => {
    const date = new Date(dateStr + "T12:00:00");
    return date.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
    });
};

interface DateHierarchy {
    year: string;
    months: { month: string; dates: string[] }[];
}

const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
];

const groupEditionsByHierarchy = (editions: string[]): DateHierarchy[] => {
    const map = new Map<string, Map<string, string[]>>();
    for (const date of editions) {
        const [year, month] = date.split("-");
        if (!map.has(year)) map.set(year, new Map());
        const monthMap = map.get(year)!;
        if (!monthMap.has(month)) monthMap.set(month, []);
        monthMap.get(month)!.push(date);
    }
    return Array.from(map.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([year, monthMap]) => ({
            year,
            months: Array.from(monthMap.entries())
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([month, dates]) => ({ month, dates: dates.sort() })),
        }));
};

const formatMonth = (monthNum: string): string =>
    MONTH_NAMES[parseInt(monthNum, 10) - 1] ?? monthNum;

const formatDateInPicker = (dateStr: string): string => {
    const date = new Date(dateStr + "T12:00:00");
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

interface TimeControlsProps {
    /** Date already resolved by an edition route. General routes show the latest edition. */
    currentDate?: string | null;
}

export const TimeControls: React.FC<TimeControlsProps> = ({ currentDate: routeDate }) => {
    const router = useRouter();
    const pathname = usePathname();
    const { editions, hasEditions } = useArchive();
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [activeOption, setActiveOption] = useState<string | null>(null);
    const [pendingDate, setPendingDate] = useState<string | null>(null);
    const [isNavigationPending, startNavigation] = useTransition();
    const shouldReduceMotion = useReducedMotion();
    const dropdownRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const optionRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
    const listboxId = useId();
    const listboxLabelId = useId();
    const canOpenDropdown = hasEditions;
    const currentDate = routeDate ?? editions[editions.length - 1] ?? null;
    const hierarchy = groupEditionsByHierarchy(editions);

    const closeDropdown = useCallback((returnFocus = false) => {
        setIsDropdownOpen(false);
        if (returnFocus) {
            window.requestAnimationFrame(() => triggerRef.current?.focus());
        }
    }, []);

    const openDropdown = useCallback((edge?: "first" | "last") => {
        const target = edge === "first"
            ? editions[0]
            : edge === "last"
                ? editions[editions.length - 1]
                : currentDate && editions.includes(currentDate)
                    ? currentDate
                    : editions[editions.length - 1];
        if (!target) return;
        setActiveOption(target);
        setIsDropdownOpen(true);
    }, [currentDate, editions]);

    // Move DOM focus into the popup once its selected/edge option exists.
    useEffect(() => {
        if (!isDropdownOpen || !activeOption) return undefined;
        const frame = window.requestAnimationFrame(() => {
            optionRefs.current.get(activeOption)?.focus();
        });
        return () => window.cancelAnimationFrame(frame);
    }, [activeOption, isDropdownOpen]);

    // Warm the current and adjacent edition routes without serializing article data
    // into the global provider. Programmatic date changes then retain the current UI
    // while the target route resolves.
    useEffect(() => {
        if (!currentDate || editions.length === 0) return;
        const currentIndex = editions.indexOf(currentDate);
        const dates = new Set<string>([currentDate]);
        if (currentIndex !== -1 && editions.length > 1) {
            dates.add(editions[(currentIndex - 1 + editions.length) % editions.length]);
            dates.add(editions[(currentIndex + 1) % editions.length]);
        }
        dates.forEach((date) => router.prefetch(`/edition/${date}`));
    }, [currentDate, editions, router]);

    const handleEditionSelect = (date: string) => {
        if (pathname === `/edition/${date}`) {
            closeDropdown(true);
            return;
        }
        setPendingDate(date);
        closeDropdown();
        markExplicitEditionNavigation(date);
        router.prefetch(`/edition/${date}`);
        startNavigation(() => {
            router.push(`/edition/${date}`);
        });
    };

    const focusOptionAt = (index: number) => {
        const date = editions[index];
        if (!date) return;
        setActiveOption(date);
        optionRefs.current.get(date)?.focus();
    };

    const handleOptionKeyDown = (
        event: React.KeyboardEvent<HTMLButtonElement>,
        date: string,
    ) => {
        const index = editions.indexOf(date);
        if (index === -1) return;
        if (event.key === "ArrowDown") {
            event.preventDefault();
            focusOptionAt((index + 1) % editions.length);
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            focusOptionAt((index - 1 + editions.length) % editions.length);
        } else if (event.key === "Home") {
            event.preventDefault();
            focusOptionAt(0);
        } else if (event.key === "End") {
            event.preventDefault();
            focusOptionAt(editions.length - 1);
        }
    };

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                closeDropdown();
            }
        };

        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [closeDropdown]);

    // Close dropdown on escape key
    useEffect(() => {
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape" && isDropdownOpen) {
                event.preventDefault();
                closeDropdown(true);
            }
        };

        document.addEventListener("keydown", handleEscape);
        return () => document.removeEventListener("keydown", handleEscape);
    }, [closeDropdown, isDropdownOpen]);

    return (
        <header
            className="h-[var(--header-height)] w-full flex items-center justify-between px-6 text-[var(--color-text-header)] time-controls-header transition-colors duration-300 z-[var(--z-header)] fixed top-0 left-0"
        >
            <div className="time-controls-title-group min-w-0 flex-1 overflow-hidden">
                <div className="text-xs sm:text-sm font-header uppercase tracking-wider sm:tracking-widest leading-none text-[var(--color-text-secondary)] whitespace-nowrap truncate">
                    <Link
                        href="/"
                        className="inline-flex min-h-[44px] items-center hover:text-[var(--color-accent-text)] transition-colors focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus-ring)]"
                        aria-label="Return to landing page"
                    >
                        <span className="hidden sm:inline">The Transcript Archive</span>
                        <span className="sm:hidden">The Transcript</span>
                    </Link>
                </div>
            </div>

            <div className="time-controls-date-group flex items-center gap-0.5 sm:gap-2 flex-shrink-0">
                <Link
                    href="/ask"
                    className={`flex items-center justify-center min-w-[44px] min-h-[44px] text-xs font-mono rounded-sm transition-colors focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus-ring)] ${
                        pathname?.startsWith("/ask")
                            ? "text-[var(--color-accent-text)] bg-[var(--color-accent)]/10"
                            : "opacity-70 hover:opacity-100 hover:bg-[var(--color-accent)]/8"
                    }`}
                    aria-label="Ask the archive"
                    aria-current={pathname?.startsWith("/ask") ? "page" : undefined}
                >
                    <MessageCircleQuestion className="w-4 h-4" />
                </Link>
                <Link
                    href="/search"
                    className={`flex items-center justify-center min-w-[44px] min-h-[44px] text-xs font-mono rounded-sm transition-colors focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus-ring)] ${
                        pathname?.startsWith("/search")
                            ? "text-[var(--color-accent-text)] bg-[var(--color-accent)]/10"
                            : "opacity-70 hover:opacity-100 hover:bg-[var(--color-accent)]/8"
                    }`}
                    aria-label="Search the archive"
                    aria-current={pathname?.startsWith("/search") ? "page" : undefined}
                >
                    <Search className="w-4 h-4" />
                </Link>
                <ThemeModeToggle iconOnly />
                <div
                    className="relative"
                    ref={dropdownRef}
                    onBlur={(event) => {
                        const next = event.relatedTarget;
                        if (next && event.currentTarget.contains(next)) return;
                        closeDropdown();
                    }}
                >
                <button
                    ref={triggerRef}
                    onFocus={(event) => {
                        if (
                            isDropdownOpen &&
                            event.relatedTarget instanceof Node &&
                            dropdownRef.current?.contains(event.relatedTarget)
                        ) {
                            closeDropdown();
                        }
                    }}
                    onClick={() => {
                        if (!canOpenDropdown) return;
                        if (isDropdownOpen) closeDropdown();
                        else openDropdown();
                    }}
                    onKeyDown={(event) => {
                        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                            event.preventDefault();
                            openDropdown(event.key === "ArrowDown" ? "first" : "last");
                        }
                    }}
                    disabled={!canOpenDropdown || isNavigationPending}
                    className={`flex items-center gap-1 sm:gap-2 min-h-[44px] text-sm font-medium px-2 sm:px-3 py-1.5 rounded-sm hover:bg-[var(--color-accent)]/8 transition-colors focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus-ring)] ${
                        isDropdownOpen
                            ? "text-[var(--color-accent-text)] bg-[var(--color-accent)]/10"
                            : "text-[var(--color-text-header)]"
                    }`}
                    aria-expanded={isDropdownOpen}
                    aria-haspopup="listbox"
                    aria-label="Select edition date"
                    aria-busy={isNavigationPending}
                    aria-controls={isDropdownOpen ? listboxId : undefined}
                >
                    <Calendar className="w-4 h-4 opacity-60" />
                    <span className="hidden sm:inline font-mono tracking-wider uppercase text-xs whitespace-nowrap">
                        {isNavigationPending && pendingDate
                            ? `Opening ${formatDisplayDate(pendingDate)}…`
                            : currentDate
                                ? formatDisplayDate(currentDate)
                                : "No editions loaded"}
                    </span>
                    <ChevronDown
                        className={`w-3 h-3 transition-transform duration-200 ${isDropdownOpen ? "rotate-180" : ""
                            }`}
                    />
                </button>

                <AnimatePresence>
                    {isDropdownOpen && canOpenDropdown && (
                        <motion.div
                            initial={shouldReduceMotion ? false : { opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={shouldReduceMotion ? undefined : { opacity: 0, y: -10 }}
                            transition={shouldReduceMotion ? { duration: 0 } : TRANSITIONS.micro}
                            className="absolute right-0 top-full z-[var(--z-max)] mt-1 bg-[var(--color-bg-secondary)] rounded-sm shadow-lg border border-[var(--color-border-default)] overflow-hidden min-w-[240px]"
                        >
                            <div className="px-4 py-2 border-b border-[var(--color-border-default)]">
                                <p
                                    id={listboxLabelId}
                                    className="text-xs font-mono text-[var(--color-text-secondary)] uppercase tracking-widest"
                                >
                                    {editions.length} Editions Available
                                </p>
                            </div>
                            <div
                                id={listboxId}
                                role="listbox"
                                aria-label="Available editions"
                                aria-describedby={listboxLabelId}
                                className="max-h-[400px] overflow-y-auto"
                            >
                                {hierarchy.flatMap(({ year, months }) =>
                                    months.map(({ month, dates }, monthIndex) => (
                                        <div
                                            key={`${year}-${month}`}
                                            role="group"
                                            aria-label={`${formatMonth(month)} ${year}`}
                                        >
                                            <p
                                                aria-hidden="true"
                                                className={`px-4 py-2 text-xs font-mono font-medium uppercase tracking-wide text-[var(--color-text-secondary)] ${
                                                    monthIndex === 0 ? "border-t-0" : "border-t border-[var(--color-border-default)]"
                                                }`}
                                            >
                                                {formatMonth(month)} {year}
                                            </p>
                                            {dates.map((date) => {
                                                const isSelected = date === currentDate;
                                                return (
                                                    <button
                                                        key={date}
                                                        ref={(node) => {
                                                            if (node) optionRefs.current.set(date, node);
                                                            else optionRefs.current.delete(date);
                                                        }}
                                                        type="button"
                                                        role="option"
                                                        aria-selected={isSelected}
                                                        tabIndex={activeOption === date ? 0 : -1}
                                                        onFocus={() => setActiveOption(date)}
                                                        onKeyDown={(event) => handleOptionKeyDown(event, date)}
                                                        onClick={() => handleEditionSelect(date)}
                                                        className={`w-full text-left px-6 py-2 min-h-[44px] flex items-center justify-between transition-colors focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus-ring)] ${
                                                            isSelected
                                                                ? "bg-[var(--color-accent)]/10 text-[var(--color-accent-text)]"
                                                                : "text-[var(--color-text-primary)]/70 hover:bg-[var(--color-accent)]/5 hover:text-[var(--color-text-primary)]"
                                                        }`}
                                                    >
                                                        <span className="text-xs font-mono tracking-wide">
                                                            {formatDateInPicker(date)}
                                                        </span>
                                                        {isSelected && (
                                                            <span
                                                                className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)]"
                                                                aria-hidden="true"
                                                            />
                                                        )}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )),
                                )}
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
            </div>
        </header>
    );
};
