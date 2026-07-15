"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useArchive } from "@/features/archive";
import { PageShell, CathedralBackground, Ticker, useTickerAnimation, EditionPicker } from "@/shared";
import { headlines } from "@/shared/landing/data/headlines";
import { markExplicitEditionNavigation } from "@/shared/navigation/editionNavigation";
import { LandingAskTeaser } from "@/features/ask-archive/components/LandingAskTeaser";

export default function Home() {
    const { editions } = useArchive();

    // Progressive enhancement: the rails are static and readable without
    // JavaScript, then gain ambient movement when motion is permitted.
    useTickerAnimation();

    // Default to latest edition (last in sorted list); user can override via picker
    const [userSelectedEdition, setUserSelectedEdition] = useState<string | null>(null);
    const [isPickerOpen, setIsPickerOpen] = useState(false);
    const selectedEdition = userSelectedEdition ?? (editions.length > 0 ? editions[editions.length - 1] : null);

    return (
        <>
            <link
                rel="preload"
                href="/shape/landing-paper.webp"
                as="image"
                type="image/webp"
                media="(min-width: 641px)"
            />
            <PageShell
                variant="cinema"
                forcedMode="dark"
                backgroundContent={<CathedralBackground />}
                className="cinema-landing-shell"
            >
            {/* TOP TICKER */}
            <Ticker items={headlines} />

            {/* MAIN CONTENT */}
            <main id="main-content" tabIndex={-1} className="cinema-content">
                <div className="cinema-paper">
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
                                className="cinema-btn-stamp"
                            >
                                <span>Ask the archive</span>
                            </Link>
                        </div>

                        {/* DIVIDER */}
                        <div className="cinema-divider" aria-hidden="true">
                            <span className="cinema-divider-or">or</span>
                        </div>

                        {/* RIGHT: Read flow — EditionPicker + Read CTA */}
                        <div className="cinema-col-action">
                            <EditionPicker
                                editions={editions}
                                selectedEdition={selectedEdition}
                                onSelect={setUserSelectedEdition}
                                onOpenChange={setIsPickerOpen}
                            />
                            {!isPickerOpen && (
                                selectedEdition ? (
                                    <Link
                                        href={`/edition/${selectedEdition}`}
                                        className="cinema-btn"
                                        onClick={() => markExplicitEditionNavigation(selectedEdition)}
                                    >
                                        <span>Open this issue</span>
                                        <span className="cinema-btn-arrow" aria-hidden="true">→</span>
                                    </Link>
                                ) : (
                                    <button type="button" className="cinema-btn" disabled>
                                        <span>No Editions Available</span>
                                    </button>
                                )
                            )}
                        </div>
                    </div>
                </div>
            </main>

            {/* BOTTOM TICKER */}
            <Ticker items={headlines} reverse />
            </PageShell>
        </>
    );
}
