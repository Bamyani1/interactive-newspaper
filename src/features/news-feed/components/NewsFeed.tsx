"use client";

import React, { useMemo, useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { Article, VintageAd, SectionId } from "@/src/types";

import { ArticleCard } from "./ArticleCard";
import { FeaturedGrid } from "./FeaturedGrid";
import { HeroSection } from "./HeroSection";
import { ScanViewer } from "./ScanViewer";
import { AdsBoard } from "./AdsBoard";
import { EditionMasthead } from "./EditionMasthead";
import { EditionFooter } from "./EditionFooter";
import { useKeyboardNavigation, useScrollCoordinator } from "../hooks/useKeyboardNavigation";
import { fadeUp, staggerContainer, TRANSITIONS } from "@/shared/motion/motionTokens";


export const SECTION_ORDER: Article["category"][] = [
    "News",
    "Sports",
    "Features",
    "Opinion",
    "Arts",
    "Campus Life",
];

const getScannedPages = (editionDate: string, pageCount: number): string[] => {
    return Array.from(
        { length: pageCount },
        (_, index) => `/editions/${editionDate}/scanned-newspaper/page${index + 1}.jpg`
    );
};

const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
        opacity: 1,
        transition: { staggerChildren: 0.1 },
    },
};

const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0 },
};

interface NewsFeedProps {
    articles: Article[];
    ads: VintageAd[];
    editionDate: string | null;
    editions: string[];
    onDateChange: (date: string) => void;
    activeSection: SectionId;
    onSectionChange: (section: SectionId) => void;
}

export const NewsFeed: React.FC<NewsFeedProps> = ({
    articles,
    ads,
    editionDate,
    editions,
    onDateChange,
    activeSection,
    onSectionChange,
}) => {
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [focusedIndex, setFocusedIndex] = useState<number>(-1);
    const [viewerState, setViewerState] = useState({ open: false, pageIndex: 0 });
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

    const heroSource = useMemo(
        () => daysArticles,
        [daysArticles]
    );

    const heroArticle = useMemo(
        () => heroSource.find(a => a.isHero) ?? heroSource[0] ?? daysArticles.find(a => a.isHero) ?? daysArticles[0],
        [heroSource, daysArticles]
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
    const focusArticle = (article: Article) => {
        pendingFocusRef.current = { id: article.id, category: article.category };
        scrollIntentRef.current = { targetId: article.id, block: "start" };
        const sectionArticles = groupedArticles.find(g => g.category === article.category)?.articles ?? [];
        const targetIndex = sectionArticles.findIndex(item => item.id === article.id);
        if (targetIndex >= 0) setFocusedIndex(targetIndex);
        setExpandedId(article.id);
        onSectionChange(article.category);
    };

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

    const openScanViewer = (article: Article) => {
        if (scannedPages.length === 0) return;
        const page = article.page || 1;
        const clampedIndex = Math.max(0, Math.min(scannedPages.length - 1, (page ?? 1) - 1));
        setViewerState({ open: true, pageIndex: clampedIndex });
    };

    const closeScanViewer = () => setViewerState(prev => ({ ...prev, open: false }));

    const registerArticleRef = useCallback((id: string, element: HTMLElement | null) => {
        if (element) articleRefs.current.set(id, element);
        else articleRefs.current.delete(id);
    }, []);

    const sectionVariants = fadeUp(18);
    const sectionContainer = staggerContainer(0.08, 0.12);

    // ── Render ────────────────────────────────────────────────────
    return (
        <div className="w-full pb-20 bg-[var(--color-bg-primary)]">
            <div className="flex flex-col gap-0 min-h-screen">
                <EditionMasthead editionHeaderDate={editionHeaderDate} />

                <div className="flex flex-col max-w-5xl mx-auto w-full px-4 md:px-6">
                    {currentSection === "Top" ? (
                        <motion.div
                            key="top-section"
                            className="flex flex-col gap-6"
                            variants={sectionContainer}
                            initial="hidden"
                            animate="show"
                        >
                            {heroArticle && (
                                <motion.div variants={sectionVariants} transition={TRANSITIONS.base}>
                                    <HeroSection
                                        article={heroArticle}
                                        onReadMore={handleHeroReadMore}
                                        isFocused={focusedIndex === 0 && currentSection === "Top"}
                                    />
                                </motion.div>
                            )}
                            {featuredArticles.length > 0 && (
                                <motion.div variants={sectionVariants} transition={TRANSITIONS.base}>
                                    <FeaturedGrid
                                        articles={featuredArticles}
                                        onArticleClick={handleFeaturedClick}
                                        focusedId={currentSection === "Top" && focusedIndex > 0 ? topArticles[focusedIndex]?.id ?? null : null}
                                    />
                                </motion.div>
                            )}
                            <AnimatePresence mode="wait">
                                {topExpandedArticle && (
                                    <motion.div
                                        key={topExpandedArticle.id}
                                        ref={topExpandedRef}
                                        initial={{ opacity: 0, y: 18 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: 18 }}
                                        transition={TRANSITIONS.base}
                                    >
                                        <ArticleCard
                                            article={topExpandedArticle}
                                            isExpanded
                                            onToggle={() => setExpandedId(null)}
                                            onViewOriginal={openScanViewer}
                                        />
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </motion.div>
                    ) : currentSection === "Ads" ? (
                        <AdsBoard ads={ads} />
                    ) : currentArticles.length > 0 ? (
                        <motion.div
                            key={currentSection}
                            className="flex flex-col gap-6"
                            variants={containerVariants}
                            initial="hidden"
                            animate="visible"
                        >
                            {currentArticles.map((article, index) => (
                                <motion.div
                                    key={article.id}
                                    variants={itemVariants}
                                    ref={(el) => registerArticleRef(article.id, el)}
                                    className={focusedIndex === index ? "ring-2 ring-[var(--color-accent)] ring-offset-2 ring-offset-[var(--color-bg-primary)] rounded-sm" : ""}
                                >
                                    <ArticleCard
                                        article={article}
                                        isExpanded={expandedId === article.id}
                                        onToggle={() => setExpandedId(prev => (prev === article.id ? null : article.id))}
                                        onViewOriginal={openScanViewer}
                                    />
                                </motion.div>
                            ))}
                        </motion.div>
                    ) : (
                        <div className="p-12 text-center opacity-60">
                            <p className="font-serif text-2xl italic mb-4">
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
                onSelectPage={(index) => setViewerState({ open: true, pageIndex: index })}
            />
        </div>
    );
};
