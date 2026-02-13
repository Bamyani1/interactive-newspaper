"use client";

import React, { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { Calendar, ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useArchive } from "@/features/archive";
import { fadeDown, TRANSITIONS } from "@/shared/motion/motionTokens";

const formatDisplayDate = (dateStr: string): string => {
    const date = new Date(dateStr + "T12:00:00");
    return date.toLocaleDateString("en-US", {
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "numeric",
    });
};

export const TimeControls = () => {
    const router = useRouter();
    const pathname = usePathname();
    const { currentDate, setDate, editions, hasEditions, isLoading } = useArchive();
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const canOpenDropdown = hasEditions && !isLoading;
    const hasCurrentEdition =
        Boolean(currentDate) && currentDate !== null && editions.includes(currentDate);

    // Set default date to first available edition when loaded
    useEffect(() => {
        if (isLoading) return;

        if (!hasEditions) {
            if (currentDate !== null) {
                setDate(null);
            }
            return;
        }

        if (!hasCurrentEdition) {
            setDate(editions[0]);
        }
    }, [editions, currentDate, hasCurrentEdition, hasEditions, isLoading, setDate]);

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

    const headerVariants = fadeDown(10);

    return (
        <motion.header
            className="h-[var(--header-height)] w-full flex items-center justify-between px-6 border-b text-[var(--owu-white)] transition-colors duration-300 z-40 fixed top-0 left-0 backdrop-blur-md bg-[var(--owu-red)]/25"
            style={{
                borderColor: "var(--owu-red-deep)",
            }}
            variants={headerVariants}
            initial="hidden"
            animate="show"
            transition={TRANSITIONS.quick}
        >
            <div className="flex items-center gap-4">
                <h1 className="text-lg font-header uppercase tracking-wider leading-none">
                    <Link
                        href="/"
                        className="hover:text-[color-mix(in_srgb,var(--owu-white)_75%,transparent)] transition-colors"
                        aria-label="Return to landing page"
                    >
                        The Transcript Archive
                    </Link>
                </h1>
            </div>

            <div className="relative" ref={dropdownRef}>
                <button
                    onClick={() => {
                        if (!canOpenDropdown) return;
                        setIsDropdownOpen((prev) => !prev);
                    }}
                    disabled={!canOpenDropdown}
                    className="flex items-center gap-2 text-lg font-bold px-3 py-2 rounded-md hover:bg-[color-mix(in_srgb,var(--owu-white)_15%,transparent)] transition-colors focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--owu-white)_60%,transparent)]"
                    aria-expanded={isDropdownOpen}
                    aria-haspopup="listbox"
                    aria-label="Select edition date"
                >
                    <Calendar className="w-5 h-5" />
                    <span className="font-header tracking-wide">
                        {isLoading
                            ? "Loading..."
                            : hasCurrentEdition && currentDate
                                ? formatDisplayDate(currentDate)
                                : "No editions loaded"}
                    </span>
                    <ChevronDown
                        className={`w-4 h-4 transition-transform duration-200 ${isDropdownOpen ? "rotate-180" : ""
                            }`}
                    />
                </button>

                <AnimatePresence>
                    {isDropdownOpen && canOpenDropdown && (
                        <motion.div
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            transition={{ duration: 0.15 }}
                            className="absolute right-0 top-full mt-2 bg-[var(--color-bg-secondary)] backdrop-blur-md rounded-sm shadow-xl border overflow-hidden min-w-[280px]"
                            style={{ borderColor: "var(--stroke-accent-soft)" }}
                            role="listbox"
                            aria-label="Available editions"
                        >
                            <div
                                className="px-4 py-2 border-b border-dashed"
                                style={{ borderColor: "var(--stroke-accent-soft)" }}
                            >
                                <p className="text-xs font-mono text-[var(--color-accent)] uppercase tracking-widest">
                                    Available Editions ({editions.length})
                                </p>
                            </div>
                            <ul className="max-h-[300px] overflow-y-auto">
                                {editions.map((date) => {
                                    const isSelected = date === currentDate;
                                    return (
                                        <li key={date}>
                                            <button
                                                onClick={() => handleEditionSelect(date)}
                                                className={`w-full text-left px-4 py-3 flex items-center justify-between transition-colors border-l-2 ${isSelected
                                                    ? "border-l-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]"
                                                    : "border-l-transparent text-[var(--color-text-primary)]/80 hover:bg-[var(--color-accent)]/5 hover:text-[var(--color-text-primary)]"
                                                    }`}
                                                role="option"
                                                aria-selected={isSelected}
                                            >
                                                <span className="font-medium font-header">
                                                    {formatDisplayDate(date)}
                                                </span>
                                                {isSelected && (
                                                    <span className="text-[10px] uppercase tracking-widest font-mono opacity-70">
                                                        Current
                                                    </span>
                                                )}
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </motion.header>
    );
};
