"use client";

import React, { useMemo, useState, useRef, useEffect } from "react";
import type { Article, VintageAd, SectionId } from "@/src/types";

import { ScanViewer } from "./ScanViewer";
import { AdsSection, ClassifiedsSection } from "./AdsSection";
import { EditionMasthead } from "./EditionMasthead";
import { EditionFooter } from "./EditionFooter";
import { useKeyboardNavigation, useScrollCoordinator } from "../hooks/useKeyboardNavigation";
import { useScanViewer } from "../hooks/useScanViewer";

import { TopStoriesPrintEdition } from "./variants/TopStoriesPrintEdition";
import { SectionPrintEdition } from "./variants/SectionPrintEdition";


export const SECTION_ORDER: Article["category"][] = [
    "Campus News",
    "News",
    "Sports",
    "Opinion",
    "Arts & Entertainment",
];

const getScannedPages = (editionDate: string, pageCount: number): string[] => {
    return Array.from(
        { length: pageCount },
        (_, index) => `/editions/${editionDate}/scanned-newspaper/page${index + 1}.jpg`
    );
};


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
}) => {
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [focusedIndex, setFocusedIndex] = useState<number>(-1);
    const articleRefs = useRef<Map<string, HTMLElement>>(new Map());
    const topExpandedRef = useRef<HTMLDivElement>(null);
    const pendingFocusRef = useRef<{ id: string; category: Article["category"] } | null>(null);
    const scrollIntentRef = useRef<{ targetId: string; block: ScrollLogicalPosition } | null>(null);

    const resolvedEditionDate = editionDate ?? articles[0]?.date ?? null;
    const daysArticles = articles;

    // ── Derived data ──────────────────────────────────────────────
    const maxPageNumber = useMemo(
        () => daysArticles.reduce((max, a) => Math.max(max, a.page || 0), 0),
        [daysArticles]
    );

    const scannedPages = useMemo(
        () => resolvedEditionDate && maxPageNumber > 0
            ? getScannedPages(resolvedEditionDate, maxPageNumber)
            : [],
        [resolvedEditionDate, maxPageNumber]
    );

    const { viewerState, openScanViewer, closeScanViewer, selectPage } = useScanViewer(scannedPages);

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

    const topExpandedArticle = useMemo(
        () => currentSection !== "Top" || expandedId == null ? null : articles.find(a => a.id === expandedId) ?? null,
        [currentSection, expandedId, articles]
    );

    const topArticles = useMemo(() => {
        const list: Article[] = [];
        if (heroArticle) list.push(heroArticle);
        list.push(...featuredArticles);
        return list;
    }, [heroArticle, featuredArticles]);

    const navArticles = useMemo(
        () => currentSection === "Top" ? topArticles : currentArticles,
        [currentSection, topArticles, currentArticles]
    );

    const editionHeaderDate = useMemo(() => {
        if (!resolvedEditionDate) return "No date selected";
        try {
            return new Intl.DateTimeFormat("en-US", {
                weekday: "long", month: "long", day: "numeric", year: "numeric",
            }).format(new Date(resolvedEditionDate));
        } catch { return resolvedEditionDate; }
    }, [resolvedEditionDate]);

    // Reset focus when switching sections to prevent stale focus state
    useEffect(() => {
        setFocusedIndex(-1); // eslint-disable-line react-hooks/set-state-in-effect -- reset on section change
    }, [currentSection]);

    // ── Extracted hooks ───────────────────────────────────────────
    useScrollCoordinator({
        currentSection, currentArticles, topExpandedArticle, expandedId,
        scrollIntentRef, pendingFocusRef, articleRefs, topExpandedRef,
    });

    useKeyboardNavigation({
        currentSection, navArticles, focusedIndex, setFocusedIndex,
        setExpandedId, scrollIntentRef,
    });

    // ── Event handlers ────────────────────────────────────────────
    const handleFeaturedClick = (article: Article) => {
        scrollIntentRef.current = { targetId: "__top_expanded__", block: "start" };
        setExpandedId(prev => (prev === article.id ? null : article.id));
    };

    const handleHeroReadMore = () => {
        if (heroArticle) {
            scrollIntentRef.current = { targetId: "__top_expanded__", block: "start" };
            setExpandedId(heroArticle.id);
        }
    };

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
                            topExpandedArticle={topExpandedArticle}
                            expandedId={expandedId}
                            focusedIndex={focusedIndex}
                            topArticles={topArticles}
                            onHeroReadMore={handleHeroReadMore}
                            onFeaturedClick={handleFeaturedClick}
                            onExpandedToggle={() => setExpandedId(null)}
                            onViewOriginal={openScanViewer}
                            currentSection={currentSection}
                            topExpandedRef={topExpandedRef}
                        />
                    ) : currentSection === "Ads" ? (
                        <AdsSection displayAds={displayAds} />
                    ) : currentSection === "Classifieds" ? (
                        <ClassifiedsSection classifiedAds={classifiedAds} />
                    ) : currentArticles.length > 0 ? (
                        <SectionPrintEdition
                            key={currentSection}
                            articles={currentArticles}
                            onViewOriginal={openScanViewer}
                        />
                    ) : (
                        <div className="p-12 text-center opacity-60">
                            <p className="font-body text-2xl italic mb-4">
                                No stories found for this section.
                            </p>
                            <button
                                onClick={goToNextEdition}
                                disabled={!canGoToNextEdition}
                                className="px-6 py-3 border border-current hover:bg-[var(--color-text-primary)] hover:text-[var(--color-text-inverse)] transition-colors uppercase tracking-widest text-sm font-bold"
                            >
                                {canGoToNextEdition ? "Jump to Next Available Edition" : "Only One Edition Loaded"}
                            </button>
                        </div>
                    )}
                </div>

                <EditionFooter
                    onNextEdition={goToNextEdition}
                    canGoToNextEdition={canGoToNextEdition}
                />
            </div>

            <ScanViewer
                isOpen={viewerState.open}
                pages={scannedPages}
                activeIndex={viewerState.pageIndex}
                onClose={closeScanViewer}
                onSelectPage={selectPage}
            />
        </div>
    );
};
