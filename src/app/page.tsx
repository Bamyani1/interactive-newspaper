"use client";

import React, { useRef } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
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
    const btnRef = useRef<HTMLButtonElement>(null);

    // Use the extracted animation hook
    useTickerAnimation();

    const handleEnter = () => {
        setDate(demoDate);

        if (btnRef.current) {
            btnRef.current.innerHTML = `
        <span style="position: relative; z-index: 1;">Printing...</span>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="position: relative; z-index: 1; animation: spin 1s linear infinite;">
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
        </svg>
      `;
        }

        // Navigate immediately after a tiny delay so the spinner paints
        setTimeout(() => {
            router.push("/edition");
        }, 0);
    };

    // Replicate the ticker items structure (tripled for smooth loop)
    const tickerItems = [...headlines, ...headlines, ...headlines];

    return (
        <PageShell variant="cinema" backgroundContent={<CinemaBackground />}>
            <style jsx global>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>

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
                        ref={btnRef}
                        type="button"
                        className="cinema-btn"
                        onClick={handleEnter}
                    >
                        <span>Read This Edition</span>
                        <ArrowRight size={20} />
                    </button>
                </motion.div>
            </main>

            {/* BOTTOM TICKER */}
            <Ticker items={tickerItems} reverse />
        </PageShell>
    );
}
