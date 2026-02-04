"use client";

import React, { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { useArchive } from "@/features/archive";
import { PageShell } from "@/shared";
import { headlines } from "@/src/data/headlines";
import { CinemaBackground } from "@/src/components/landing/CinemaBackground";
import { Ticker, useTickerAnimation } from "@/src/components/landing/Ticker";
import { cardIn, TRANSITIONS } from "@/shared/motion/motionTokens";

export default function Home() {
    const router = useRouter();
    const { setDate } = useArchive();
    const demoDate = "1986-10-24";
    const [isLoading, setIsLoading] = useState(false);

    // Use the extracted animation hook
    useTickerAnimation();

    const handleEnter = () => {
        setDate(demoDate);
        setIsLoading(true);

        // Navigate immediately after a tiny delay so the spinner paints
        setTimeout(() => {
            router.push("/edition");
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
                        <div className="cinema-date-value">OCT 24, 1986</div>
                    </div>

                    <button
                        type="button"
                        className="cinema-btn"
                        onClick={handleEnter}
                        disabled={isLoading}
                    >
                        {isLoading ? (
                            <>
                                <span>Printing...</span>
                                <Loader2 size={20} className="animate-spin" />
                            </>
                        ) : (
                            <>
                                <span>Read This Edition</span>
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
