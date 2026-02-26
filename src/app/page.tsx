"use client";

import React, { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { useArchive } from "@/features/archive";
import { PageShell, CinemaBackground, Ticker, useTickerAnimation, EditionPicker } from "@/shared";
import { headlines } from "@/shared/landing/data/headlines";
import { landingCardVariants, TRANSITIONS } from "@/shared/motion/motionTokens";

let hasPlayedEntrance = false;

export default function Home() {
    const router = useRouter();
    const { editions, isLoading } = useArchive();
    const [isReadMode, setIsReadMode] = useState(false);
    const [isExiting, setIsExiting] = useState(false);

    // Use the extracted animation hook
    useTickerAnimation();

    // Default to latest edition (last in sorted list); user can override via picker
    const [userSelectedEdition, setUserSelectedEdition] = useState<string | null>(null);
    const [isPickerOpen, setIsPickerOpen] = useState(false);
    const selectedEdition = userSelectedEdition ?? (editions.length > 0 ? editions[editions.length - 1] : null);

    const handleEnter = () => {
        if (!selectedEdition) return;
        setIsReadMode(true);
    };

    const handleNavigate = () => {
        if (!selectedEdition) return;
        setIsExiting(true);
    };

    const handleBack = () => {
        setIsReadMode(false);
    };

    // Memoize ticker items to prevent recreation on every render
    const tickerItems = useMemo(
        () => [...headlines, ...headlines, ...headlines],
        []
    );

    return (
        <PageShell variant="cinema" backgroundContent={<CinemaBackground />}>
            {/* TOP TICKER */}
            <Ticker items={tickerItems} />

            {/* MAIN CONTENT */}
            <main className="cinema-content">
                <motion.div
                    className="cinema-paper"
                    variants={landingCardVariants}
                    initial={hasPlayedEntrance ? false : "hidden"}
                    animate="show"
                    transition={TRANSITIONS.slow}
                    onAnimationComplete={(definition) => {
                        if (definition === "show") {
                            hasPlayedEntrance = true;
                        }
                    }}
                >
                    <header className="cinema-masthead">
                        <h1 className="cinema-title">The Transcript</h1>
                        <p className="cinema-subtitle">Student Newspaper Since 1867</p>
                    </header>

                    <div className={`cinema-paper-grid ${isReadMode ? "cinema-paper-grid--read-mode" : ""} ${isPickerOpen ? "cinema-paper-grid--picker-open" : ""}`}>
                        {/* Landing content — ALWAYS rendered, hidden via CSS when read mode */}
                        <div className={`cinema-col-brand ${isPickerOpen ? "cinema-col-brand--hidden" : ""}`}>
                            <h2 className="cinema-headline">
                                Travel Back in Time.<br />
                                Experience Campus History.
                            </h2>
                        </div>

                        {/* DIVIDER */}
                        <div className="cinema-divider" aria-hidden="true" />

                        {/* RIGHT: Action */}
                        <div className="cinema-col-action">
                            <EditionPicker
                                editions={editions}
                                selectedEdition={selectedEdition}
                                onSelect={setUserSelectedEdition}
                                isLoading={isLoading}
                                onOpenChange={setIsPickerOpen}
                            />
                        </div>

                        {/* Expanded picker — only mounted when read mode, overlays on top */}
                        {isReadMode && (
                            <motion.div
                                className="cinema-expanded-overlay"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                transition={{ duration: 0.25, delay: 0.1 }}
                            >
                                <EditionPicker
                                    editions={editions}
                                    selectedEdition={selectedEdition}
                                    onSelect={setUserSelectedEdition}
                                    isLoading={isLoading}
                                    expanded
                                    onNavigate={handleNavigate}
                                    onBack={handleBack}
                                />
                            </motion.div>
                        )}
                    </div>

                    {/* Read button — only in landing mode */}
                    {!isReadMode && !isPickerOpen && (
                        <button
                            type="button"
                            className="cinema-btn"
                            onClick={handleEnter}
                            disabled={isLoading || !selectedEdition}
                        >
                            {isLoading ? (
                                <>
                                    <span>Loading Editions...</span>
                                    <Loader2 size={20} className="animate-spin" />
                                </>
                            ) : (
                                <>
                                    <span>{selectedEdition ? "Read" : "No Editions Available"}</span>
                                    <ArrowRight size={20} />
                                </>
                            )}
                        </button>
                    )}
                </motion.div>
            </main>

            {/* BOTTOM TICKER */}
            <Ticker items={tickerItems} reverse />

            {/* White wash-out transition */}
            <motion.div
                className="fixed inset-0 z-50 pointer-events-none"
                style={{ backgroundColor: "#fff" }}
                initial={{ opacity: 0 }}
                animate={{ opacity: isExiting ? 1 : 0 }}
                transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
                onAnimationComplete={() => {
                    if (isExiting && selectedEdition) {
                        router.push(`/edition/${selectedEdition}`);
                    }
                }}
            />
        </PageShell>
    );
}
