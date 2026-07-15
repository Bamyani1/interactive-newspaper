"use client";

import React, { useMemo } from "react";
import type { Article, VintageAd, SectionId } from "@/src/types";

import { AdsSection, ClassifiedsSection } from "./AdsSection";
import { EditionMasthead } from "./EditionMasthead";
import { EditionFooter } from "./EditionFooter";

import { TopStoriesPrintEdition } from "./variants/TopStoriesPrintEdition";
import { SectionPrintEdition } from "./variants/SectionPrintEdition";


export const SECTION_ORDER: Article["category"][] = [
    "Campus News",
    "News",
    "Sports",
    "Opinion",
    "Arts & Entertainment",
];

interface NewsFeedProps {
    articles: Article[];
    displayAds: VintageAd[];
    classifiedAds: VintageAd[];
    editionDate: string | null;
    editions: string[];
    onDateChange: (date: string) => void;
    activeSection: SectionId;
    onSectionChange: (section: SectionId) => void;
    publicationInfo?: string;
    isEditionPending?: boolean;
}

export const NewsFeed: React.FC<NewsFeedProps> = ({
    articles,
    displayAds,
    classifiedAds,
    editionDate,
    editions,
    onDateChange,
    activeSection,
    onSectionChange: _onSectionChange,
    publicationInfo,
    isEditionPending = false,
}) => {
    const resolvedEditionDate = editionDate ?? articles[0]?.date ?? null;
    const daysArticles = articles;

    // ── Derived data ──────────────────────────────────────────────
    const heroArticle = useMemo(
        () => daysArticles.find(a => a.isHero) ?? daysArticles[0],
        [daysArticles]
    );

    const featuredArticles = useMemo(
        () => daysArticles.filter(a => a.isFeatured && a.id !== heroArticle?.id),
        [daysArticles, heroArticle]
    );

    const groupedArticles = useMemo(
        () => SECTION_ORDER.map(category => ({
            category,
            articles: daysArticles.filter(a => a.category === category),
        })).filter(g => g.articles.length > 0),
        [daysArticles]
    );

    const sortedEditions = useMemo(() => [...editions].sort((a, b) => a.localeCompare(b)), [editions]);

    const canGoToNextEdition = Boolean(resolvedEditionDate) && sortedEditions.length > 1;

    const goToNextEdition = () => {
        if (!resolvedEditionDate || sortedEditions.length === 0) return;
        const currentIndex = sortedEditions.indexOf(resolvedEditionDate);
        if (currentIndex === -1) { onDateChange(sortedEditions[0]); return; }
        const nextIndex = (currentIndex + 1) % sortedEditions.length;
        if (nextIndex === currentIndex) return;
        onDateChange(sortedEditions[nextIndex]);
    };

    // ── Section & navigation state ────────────────────────────────
    const currentSection = useMemo<SectionId>(() => {
        if (activeSection === "Top") return "Top";
        if (activeSection === "Ads") return "Ads";
        if (activeSection === "Classifieds") return "Classifieds";
        const exists = groupedArticles.some(s => s.category === activeSection);
        return exists ? activeSection : "Top";
    }, [activeSection, groupedArticles]);

    const currentArticles = useMemo(
        () => currentSection === "Top" ? [] : groupedArticles.find(g => g.category === currentSection)?.articles ?? [],
        [currentSection, groupedArticles]
    );

    const editionHeaderDate = useMemo(() => {
        if (!resolvedEditionDate) return "No date selected";
        try {
            // Append T12:00:00 (no Z) so Date parses as local noon on both
            // server (UTC) and client (any TZ). Guards against the ECMAScript
            // rule that bare "YYYY-MM-DD" parses as UTC midnight, which would
            // shift to the previous calendar day in any negative-UTC client
            // timezone and produce a hydration mismatch with the SSR output.
            return new Intl.DateTimeFormat("en-US", {
                weekday: "long", month: "long", day: "numeric", year: "numeric",
            }).format(new Date(resolvedEditionDate + "T12:00:00"));
        } catch { return resolvedEditionDate; }
    }, [resolvedEditionDate]);

    const strokeWrapperClass =
        "bg-[var(--color-bg-primary)] border-x-[6.4px] border-[var(--color-accent)] px-6 py-8 md:px-10 md:py-10";
    const strokeWrapperStyle = {};

    // ── Render ────────────────────────────────────────────────────
    return (
        <div className="edition-feed-surface w-full bg-[var(--color-bg-primary)]">
            <div
                className={`${strokeWrapperClass} flex flex-col gap-0 min-h-screen`}
                style={strokeWrapperStyle}
            >
                <EditionMasthead editionHeaderDate={editionHeaderDate} publicationInfo={publicationInfo} />

                <div
                    className="flex flex-col max-w-5xl mx-auto px-4 md:px-6 w-full"
                >
                    {currentSection === "Top" ? (
                        <TopStoriesPrintEdition
                            heroArticle={heroArticle}
                            featuredArticles={featuredArticles}
                        />
                    ) : currentSection === "Ads" ? (
                        <AdsSection displayAds={displayAds} />
                    ) : currentSection === "Classifieds" ? (
                        <ClassifiedsSection classifiedAds={classifiedAds} />
                    ) : currentArticles.length > 0 ? (
                        <SectionPrintEdition
                            key={currentSection}
                            articles={currentArticles}
                        />
                    ) : (
                        <div className="p-12 text-center opacity-60">
                            <p className="font-body text-2xl italic mb-4">
                                No stories found for this section.
                            </p>
                            <button
                                onClick={goToNextEdition}
                                disabled={!canGoToNextEdition || isEditionPending}
                                className="px-6 py-3 border border-current hover:bg-[var(--color-text-primary)] hover:text-[var(--color-text-inverse)] transition-colors uppercase tracking-widest text-sm font-bold"
                                aria-busy={isEditionPending}
                            >
                                {isEditionPending
                                    ? "Opening Edition…"
                                    : canGoToNextEdition
                                        ? "Jump to Next Available Edition"
                                        : "Only One Edition Loaded"}
                            </button>
                        </div>
                    )}
                </div>

                <EditionFooter
                    onNextEdition={goToNextEdition}
                    canGoToNextEdition={canGoToNextEdition}
                    isPending={isEditionPending}
                />
            </div>

        </div>
    );
};
