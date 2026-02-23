"use client";

import React, { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { Calendar, ChevronDown, ChevronRight, MessageCircleQuestion, Search } from "lucide-react";
import { ThemeModeToggle } from "@/features/theme";
import { motion, AnimatePresence } from "framer-motion";
import { useArchive } from "@/features/archive";
import { fadeDown, staggerContainer, TRANSITIONS } from "@/shared/motion/motionTokens";
// Note: fadeDown + staggerContainer still used for dropdown year/month/date stagger animations

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

export const TimeControls = () => {
    const router = useRouter();
    const pathname = usePathname();
    const { currentDate, setDate, editions, hasEditions, isLoading } = useArchive();
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [expandedYear, setExpandedYear] = useState<string | null>(null);
    const [expandedMonth, setExpandedMonth] = useState<string | null>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const canOpenDropdown = hasEditions && !isLoading;
    const hasCurrentEdition =
        Boolean(currentDate) && currentDate !== null && editions.includes(currentDate);
    const hierarchy = groupEditionsByHierarchy(editions);

    // Auto-expand current date's year+month when dropdown opens; collapse on close
    useEffect(() => {
        if (isDropdownOpen && currentDate) {
            const [year, month] = currentDate.split("-");
            setExpandedYear(year);
            setExpandedMonth(month);
        } else if (!isDropdownOpen) {
            setExpandedYear(null);
            setExpandedMonth(null);
        }
    }, [isDropdownOpen, currentDate]);

    // Set default date to first available edition when loaded
    useEffect(() => {
        if (isLoading) return;

        if (!hasEditions) {
            if (currentDate !== null) {
                setDate(null);
            }
            return;
        }

        // Only set default date if NOT on an edition page (edition page syncs from URL)
        if (!hasCurrentEdition && !pathname?.startsWith("/edition")) {
            setDate(editions[editions.length - 1]);
        }
    }, [editions, currentDate, hasCurrentEdition, hasEditions, isLoading, setDate, pathname]);

    const handleEditionSelect = (date: string) => {
        setDate(date);
        setIsDropdownOpen(false);
        // Navigate to the date-based URL if we're on an edition page
        if (pathname?.startsWith("/edition")) {
            router.push(`/edition/${date}`);
        }
    };

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsDropdownOpen(false);
            }
        };

        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    // Close dropdown on escape key
    useEffect(() => {
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setIsDropdownOpen(false);
            }
        };

        document.addEventListener("keydown", handleEscape);
        return () => document.removeEventListener("keydown", handleEscape);
    }, []);

    return (
        <header
            className="h-[var(--header-height)] w-full flex items-center justify-between px-6 text-[var(--color-text-header)] time-controls-header transition-colors duration-300 z-[var(--z-header)] fixed top-0 left-0"
        >
            <div className="time-controls-title-group">
                <h1 className="text-sm font-header uppercase tracking-widest leading-none opacity-80">
                    <Link
                        href="/"
                        className="hover:text-[var(--color-accent)] transition-colors"
                        aria-label="Return to landing page"
                    >
                        The Transcript Archive
                    </Link>
                </h1>
            </div>

            <div className="time-controls-date-group flex items-center gap-2">
                <Link
                    href="/ask"
                    className={`flex items-center gap-1.5 text-xs font-mono px-2.5 py-1.5 rounded-sm transition-colors focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]/30 ${
                        pathname?.startsWith("/ask")
                            ? "text-[var(--color-accent)] bg-[var(--color-accent)]/10"
                            : "opacity-70 hover:opacity-100 hover:bg-[var(--color-accent)]/8"
                    }`}
                    aria-label="Ask the archive"
                >
                    <MessageCircleQuestion className="w-4 h-4" />
                </Link>
                <Link
                    href="/search"
                    className={`flex items-center gap-1.5 text-xs font-mono px-2.5 py-1.5 rounded-sm transition-colors focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]/30 ${
                        pathname?.startsWith("/search")
                            ? "text-[var(--color-accent)] bg-[var(--color-accent)]/10"
                            : "opacity-70 hover:opacity-100 hover:bg-[var(--color-accent)]/8"
                    }`}
                    aria-label="Search the archive"
                >
                    <Search className="w-4 h-4" />
                </Link>
                <ThemeModeToggle iconOnly />
                <div className="relative" ref={dropdownRef}>
                <button
                    onClick={() => {
                        if (!canOpenDropdown) return;
                        setIsDropdownOpen((prev) => !prev);
                    }}
                    disabled={!canOpenDropdown}
                    className="flex items-center gap-2 text-sm font-medium px-3 py-1.5 rounded-sm hover:bg-[var(--color-accent)]/8 transition-colors focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]/30"
                    aria-expanded={isDropdownOpen}
                    aria-haspopup="listbox"
                    aria-label="Select edition date"
                >
                    <Calendar className="w-4 h-4 opacity-60" />
                    <span className="font-mono tracking-wider uppercase text-xs">
                        {isLoading
                            ? "Loading..."
                            : hasCurrentEdition && currentDate
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
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            transition={TRANSITIONS.micro}
                            className="absolute right-0 top-full z-[var(--z-max)] mt-1 bg-[var(--color-bg-secondary)] rounded-sm shadow-lg border overflow-hidden min-w-[240px]"
                            style={{ borderColor: "var(--color-border-default)" }}
                            role="listbox"
                            aria-label="Available editions"
                        >
                            <div
                                className="px-4 py-2 border-b"
                                style={{ borderColor: "var(--color-border-default)" }}
                            >
                                <p className="text-[10px] font-mono text-[var(--color-text-secondary)] uppercase tracking-widest">
                                    {editions.length} Editions Available
                                </p>
                            </div>
                            <div className="max-h-[400px] overflow-y-auto">
                                {hierarchy.map(({ year, months }) => {
                                    const isYearExpanded = expandedYear === year;
                                    const containsCurrent = currentDate?.startsWith(year) ?? false;
                                    return (
                                        <div key={year}>
                                            {/* Year header */}
                                            <button
                                                onClick={() => {
                                                    setExpandedYear(isYearExpanded ? null : year);
                                                    if (!isYearExpanded) setExpandedMonth(null);
                                                }}
                                                className={`w-full text-left px-4 py-2.5 flex items-center gap-2 transition-colors ${
                                                    containsCurrent
                                                        ? "text-[var(--color-accent)]"
                                                        : "text-[var(--color-text-primary)]/80"
                                                } hover:bg-[var(--color-accent)]/5`}
                                                aria-expanded={isYearExpanded}
                                            >
                                                <ChevronRight
                                                    className={`w-3 h-3 transition-transform duration-200 ${
                                                        isYearExpanded ? "rotate-90" : ""
                                                    }`}
                                                />
                                                <span className="text-sm font-mono font-medium tracking-wide">
                                                    {year}
                                                </span>
                                            </button>

                                            {/* Months within year */}
                                            <AnimatePresence initial={false}>
                                                {isYearExpanded && (
                                                    <motion.div
                                                        initial={{ height: 0, opacity: 0 }}
                                                        animate={{ height: "auto", opacity: 1 }}
                                                        exit={{ height: 0, opacity: 0 }}
                                                        transition={TRANSITIONS.micro}
                                                        style={{ overflow: "hidden" }}
                                                    >
                                                        <motion.div
                                                            variants={staggerContainer(0.05)}
                                                            initial="hidden"
                                                            animate="show"
                                                        >
                                                            {months.map(({ month, dates }) => {
                                                                const isMonthExpanded = expandedMonth === month;
                                                                const monthContainsCurrent =
                                                                    currentDate?.startsWith(`${year}-${month}`) ?? false;
                                                                return (
                                                                    <motion.div
                                                                        key={month}
                                                                        variants={fadeDown(6)}
                                                                    >
                                                                        {/* Month header */}
                                                                        <button
                                                                            onClick={() =>
                                                                                setExpandedMonth(
                                                                                    isMonthExpanded ? null : month
                                                                                )
                                                                            }
                                                                            className={`w-full text-left px-6 py-2 flex items-center justify-between transition-colors ${
                                                                                monthContainsCurrent
                                                                                    ? "text-[var(--color-accent)]"
                                                                                    : "text-[var(--color-text-primary)]/70"
                                                                            } hover:bg-[var(--color-accent)]/5`}
                                                                            aria-expanded={isMonthExpanded}
                                                                        >
                                                                            <span className="flex items-center gap-2">
                                                                                <ChevronRight
                                                                                    className={`w-2.5 h-2.5 transition-transform duration-200 ${
                                                                                        isMonthExpanded ? "rotate-90" : ""
                                                                                    }`}
                                                                                />
                                                                                <span className="text-xs font-mono tracking-wide">
                                                                                    {formatMonth(month)}
                                                                                </span>
                                                                            </span>
                                                                            <span className="text-[10px] font-mono text-[var(--color-text-secondary)] opacity-60">
                                                                                {dates.length}
                                                                            </span>
                                                                        </button>

                                                                        {/* Dates within month */}
                                                                        <AnimatePresence initial={false}>
                                                                            {isMonthExpanded && (
                                                                                <motion.div
                                                                                    initial={{ height: 0, opacity: 0 }}
                                                                                    animate={{
                                                                                        height: "auto",
                                                                                        opacity: 1,
                                                                                    }}
                                                                                    exit={{ height: 0, opacity: 0 }}
                                                                                    transition={TRANSITIONS.micro}
                                                                                    style={{ overflow: "hidden" }}
                                                                                >
                                                                                    <motion.div
                                                                                        variants={staggerContainer(0.03)}
                                                                                        initial="hidden"
                                                                                        animate="show"
                                                                                    >
                                                                                        {dates.map((date) => {
                                                                                            const isSelected =
                                                                                                date === currentDate;
                                                                                            return (
                                                                                                <motion.button
                                                                                                    key={date}
                                                                                                    variants={fadeDown(4)}
                                                                                                    onClick={() =>
                                                                                                        handleEditionSelect(
                                                                                                            date
                                                                                                        )
                                                                                                    }
                                                                                                    className={`w-full text-left px-8 py-2 flex items-center justify-between transition-colors ${
                                                                                                        isSelected
                                                                                                            ? "bg-[var(--color-accent)]/10 text-[var(--color-accent)]"
                                                                                                            : "text-[var(--color-text-primary)]/70 hover:bg-[var(--color-accent)]/5 hover:text-[var(--color-text-primary)]"
                                                                                                    }`}
                                                                                                    role="option"
                                                                                                    aria-selected={
                                                                                                        isSelected
                                                                                                    }
                                                                                                >
                                                                                                    <span className="text-xs font-mono tracking-wide">
                                                                                                        {formatDateInPicker(
                                                                                                            date
                                                                                                        )}
                                                                                                    </span>
                                                                                                    {isSelected && (
                                                                                                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)]" />
                                                                                                    )}
                                                                                                </motion.button>
                                                                                            );
                                                                                        })}
                                                                                    </motion.div>
                                                                                </motion.div>
                                                                            )}
                                                                        </AnimatePresence>
                                                                    </motion.div>
                                                                );
                                                            })}
                                                        </motion.div>
                                                    </motion.div>
                                                )}
                                            </AnimatePresence>
                                        </div>
                                    );
                                })}
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
            </div>
        </header>
    );
};
