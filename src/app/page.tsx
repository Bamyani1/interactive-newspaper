"use client";

import React, { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { useArchive } from "@/features/archive";
import { PageShell, CinemaBackground, Ticker, useTickerAnimation, EditionPicker } from "@/shared";
import { headlines } from "@/shared/landing/data/headlines";
import { cardIn, TRANSITIONS } from "@/shared/motion/motionTokens";

export default function Home() {
    const router = useRouter();
    const { editions, isLoading } = useArchive();
    const [isEntering, setIsEntering] = useState(false);

    // Use the extracted animation hook
    useTickerAnimation();

    // Default to latest edition (last in sorted list)
    const [selectedEdition, setSelectedEdition] = useState<string | null>(null);
    const [isPickerOpen, setIsPickerOpen] = useState(false);
    useEffect(() => {
        if (editions.length > 0 && !selectedEdition) {
            setSelectedEdition(editions[editions.length - 1]);
        }
    }, [editions, selectedEdition]);

    const handleEnter = () => {
        if (!selectedEdition) return;
        setIsEntering(true);
        router.push(`/edition/${selectedEdition}`);
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
                    variants={cardIn}
                    initial="hidden"
                    animate="show"
                    transition={TRANSITIONS.slow}
                >
                    <header className="cinema-masthead">
                        <h1 className="cinema-title">The Transcript</h1>
                        <p className="cinema-subtitle">Student Newspaper Since 1867</p>
                    </header>

                    <div className="cinema-paper-grid">
                        {/* LEFT: Brand */}
                        <div className="cinema-col-brand">
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
                                onSelect={setSelectedEdition}
                                isLoading={isLoading}
                                onOpenChange={setIsPickerOpen}
                            />
                        </div>
                    </div>

                    {!isPickerOpen && (
                        <button
                            type="button"
                            className="cinema-btn"
                            onClick={handleEnter}
                            disabled={isLoading || isEntering || !selectedEdition}
                        >
                            {isEntering ? (
                                <>
                                    <span>Printing...</span>
                                    <Loader2 size={20} className="animate-spin" />
                                </>
                            ) : isLoading ? (
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
        </PageShell>
    );
}
