"use client";

import React, { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { useArchive } from "@/features/archive";
import { PageShell, CathedralBackground, Ticker, useTickerAnimation, EditionPicker } from "@/shared";
import { headlines } from "@/shared/landing/data/headlines";
import { landingCardVariants, TRANSITIONS } from "@/shared/motion/motionTokens";
import { LandingAskTeaser } from "@/features/ask-archive/components/LandingAskTeaser";

// The stained-glass SVG has its own inline reveal script: panels appear
// progressively with data-delay values up to ~2955ms plus an 800ms reveal
// duration per panel. By ~2.5s most panels are visible, so the card waits
// this long on first visit before gliding in. Return visits are instant
// via the cinema-instant class.
const BACKGROUND_REVEAL_DELAY = 2.5;
const CARD_REVEAL_DURATION = 1.0;

let hasPlayedEntrance = false;

export default function Home() {
    const router = useRouter();
    const { editions } = useArchive();
    const [isExiting, setIsExiting] = useState(false);

    // Use the extracted animation hook
    useTickerAnimation();

    // Default to latest edition (last in sorted list); user can override via picker
    const [userSelectedEdition, setUserSelectedEdition] = useState<string | null>(null);
    const [isPickerOpen, setIsPickerOpen] = useState(false);
    const selectedEdition = userSelectedEdition ?? (editions.length > 0 ? editions[editions.length - 1] : null);

    const handleEnter = () => {
        if (!selectedEdition) return;
        setIsExiting(true);
    };

    // Memoize ticker items to prevent recreation on every render
    const tickerItems = useMemo(
        () => [...headlines, ...headlines, ...headlines],
        []
    );

    return (
        <>
            {/* Preload the torn-paper asset so it streams in during the
                background's fade-in and is already cached by the time the
                card reveals. Invisible to the user. */}
            <link rel="preload" href="/shape/1.webp" as="image" type="image/webp" />
            <PageShell
                variant="cinema"
                backgroundContent={<CathedralBackground />}
                className={hasPlayedEntrance ? "cinema-instant" : ""}
            >
            {/* TOP TICKER */}
            <Ticker items={tickerItems} />

            {/* MAIN CONTENT */}
            <main className="cinema-content">
                <motion.div
                    className="cinema-paper"
                    variants={landingCardVariants}
                    initial={hasPlayedEntrance ? false : "hidden"}
                    animate="show"
                    transition={
                        hasPlayedEntrance
                            ? TRANSITIONS.slow
                            : { ...TRANSITIONS.slow, duration: CARD_REVEAL_DURATION, delay: BACKGROUND_REVEAL_DELAY }
                    }
                    onAnimationComplete={(definition) => {
                        if (definition === "show") {
                            hasPlayedEntrance = true;
                        }
                    }}
                >
                    <header className="cinema-masthead">
                        <h1 className="cinema-title">The Transcript Archive</h1>
                        <p className="cinema-subtitle">Travel Back in Time. Experience Campus History.</p>
                    </header>

                    <div className={`cinema-paper-grid ${isPickerOpen ? "cinema-paper-grid--picker-open" : ""}`}>
                        {/* LEFT: Ask flow — daily rotating prompt + Ask CTA */}
                        <div className={`cinema-col-brand ${isPickerOpen ? "cinema-col-brand--hidden" : ""}`}>
                            <LandingAskTeaser />
                            <Link
                                href="/ask"
                                className="cinema-btn"
                            >
                                <span>Ask the archive</span>
                                <span className="cinema-btn-arrow" aria-hidden="true">→</span>
                            </Link>
                        </div>

                        {/* DIVIDER */}
                        <div className="cinema-divider" aria-hidden="true" />

                        {/* RIGHT: Read flow — EditionPicker + Read CTA */}
                        <div className="cinema-col-action">
                            <EditionPicker
                                editions={editions}
                                selectedEdition={selectedEdition}
                                onSelect={setUserSelectedEdition}
                                onOpenChange={setIsPickerOpen}
                            />
                            {!isPickerOpen && (
                                <button
                                    type="button"
                                    className="cinema-btn"
                                    onClick={handleEnter}
                                    disabled={!selectedEdition}
                                >
                                    <span>{selectedEdition ? "Open this issue" : "No Editions Available"}</span>
                                    <span className="cinema-btn-arrow" aria-hidden="true">→</span>
                                </button>
                            )}
                        </div>
                    </div>
                </motion.div>
            </main>

            {/* BOTTOM TICKER */}
            <Ticker items={tickerItems} reverse />

            {/* Paper wash-out transition (Direction A paper tone) */}
            <motion.div
                className="fixed inset-0 z-50 pointer-events-none bg-[var(--color-bg-paper)]"
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
        </>
    );
}
