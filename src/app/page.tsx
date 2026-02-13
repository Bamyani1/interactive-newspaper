"use client";

import React, { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { useArchive } from "@/features/archive";
import { PageShell, CinemaBackground, Ticker, useTickerAnimation } from "@/shared";
import { headlines } from "@/shared/landing/data/headlines";
import { cardIn, TRANSITIONS } from "@/shared/motion/motionTokens";

export default function Home() {
    const router = useRouter();
    const { setDate, editions, hasEditions, isLoading } = useArchive();
    const [isEntering, setIsEntering] = useState(false);

    // Use the extracted animation hook
    useTickerAnimation();

    const selectedEdition = editions[0] ?? null;

    const selectedEditionLabel = useMemo(() => {
        if (!selectedEdition) {
            return "NO EDITIONS LOADED";
        }
        try {
            return new Intl.DateTimeFormat("en-US", {
                month: "short",
                day: "2-digit",
                year: "numeric",
            })
                .format(new Date(`${selectedEdition}T12:00:00`))
                .toUpperCase();
        } catch {
            return selectedEdition;
        }
    }, [selectedEdition]);

    const handleEnter = () => {
        if (!selectedEdition) return;
        setDate(selectedEdition);
        setIsEntering(true);

        // Navigate immediately after a tiny delay so the spinner paints
        setTimeout(() => {
            router.push(`/edition/${selectedEdition}`);
        }, 0);
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

                    <div className="cinema-edition-info">
                        <span>Est. 1867</span>
                        <span>Ohio Wesleyan University</span>
                        <span>150+ Years</span>
                    </div>

                    <h2 className="cinema-headline">
                        Travel Back in Time.<br />
                        Experience Campus History.
                    </h2>

                    <div className="cinema-date-box">
                        <p className="cinema-date-label">Selected Edition</p>
                        <div className="cinema-date-value">{selectedEditionLabel}</div>
                        {!isLoading && !hasEditions && (
                            <p className="mt-2 text-xs uppercase tracking-widest opacity-70">
                                Run real-material import to begin.
                            </p>
                        )}
                    </div>

                    <button
                        type="button"
                        className="cinema-btn"
                        onClick={handleEnter}
                        disabled={isLoading || isEntering || !hasEditions}
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
                                <span>{hasEditions ? "Read This Edition" : "No Editions Available"}</span>
                                <ArrowRight size={20} />
                            </>
                        )}
                    </button>
                </motion.div>
            </main>

            {/* BOTTOM TICKER */}
            <Ticker items={tickerItems} reverse />
        </PageShell>
    );
}
