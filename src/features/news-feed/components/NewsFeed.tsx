"use client";

import React, { useMemo, useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useArchive } from "@/features/archive";
import type { Article, VintageAd } from "../data/mockData";
import { EDITION_DATES, getClosestContext } from "../data/mockData";
import { ArticleCard } from "./ArticleCard";
import { FeaturedGrid } from "./FeaturedGrid";
import { HeroSection } from "./HeroSection";
import { ScanViewer } from "./ScanViewer";
import { getArticlePage } from "../lib/articleUtils";
import { AdsBoard } from "./AdsBoard";
import { ThemeModeToggle } from "@/features/theme";
import { fadeUp, staggerContainer, TRANSITIONS } from "@/shared/motion/motionTokens";

import type { SectionId } from "@/features/news-feed";
export { SECTION_ORDER };

const SECTION_ORDER: Article["category"][] = [
    "News",
    "Sports",
    "Features",
    "Opinion",
    "Arts",
    "Campus Life",
    "Ads",
];

const getScannedPages = (date: string): string[] => {
    const year = date.split("-")[0];
    return [
        `/editions/${year}/scanned-newspaper/page1.jpg`,
        `/editions/${year}/scanned-newspaper/page2.jpg`,
        `/editions/${year}/scanned-newspaper/page3.jpg`,
        `/editions/${year}/scanned-newspaper/page4.jpg`,
        `/editions/${year}/scanned-newspaper/page5.jpg`,
        `/editions/${year}/scanned-newspaper/page6.jpg`,
        `/editions/${year}/scanned-newspaper/page7.jpg`,
        `/editions/${year}/scanned-newspaper/page8.jpg`,
    ];
};

const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
        opacity: 1,
        transition: {
            staggerChildren: 0.1
        }
    }
};

const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0 }
};

interface NewsFeedProps {
    articles: Article[];
    activeSection: SectionId;
    onSectionChange: (section: SectionId) => void;
}

export const NewsFeed: React.FC<NewsFeedProps> = ({
    articles,
    activeSection,
    onSectionChange,
}) => {
    const { currentDate, setDate } = useArchive();
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [focusedIndex, setFocusedIndex] = useState<number>(-1);
    const [viewerState, setViewerState] = useState({
        open: false,
        pageIndex: 0,
    });
    const articleRefs = useRef<Map<string, HTMLElement>>(new Map());

    const scannedPages = useMemo(
        () => getScannedPages(currentDate),
        [currentDate]
    );

    const daysArticles = useMemo(
        () => articles.filter((a) => a.date === currentDate),
        [articles, currentDate]
    );

    const context = useMemo(
        () => getClosestContext(currentDate),
        [currentDate]
    );

    // Use real ads from articles with category "Ads", falling back to mock data
    const ads = useMemo((): VintageAd[] => {
        const adArticles = daysArticles.filter(a => a.category === "Ads");
        if (adArticles.length > 0) {
            return adArticles.map(a => ({
                title: a.headline,
                subtitle: a.byline || undefined,
                body: a.summary || a.fullText.substring(0, 200),
                price: undefined,
                footer: undefined,
                tag: undefined,
            }));
        }
        // Fallback to mock data if no real ads
        return context.ads ?? [];
    }, [daysArticles, context]);

    const heroSource = useMemo(() => daysArticles, [daysArticles]);

    const heroArticle = useMemo(
        () => heroSource.find((a) => a.isHero) ?? heroSource[0],
        [heroSource]
    );

    const featuredArticles = useMemo(
        () =>
            daysArticles.filter(
                (a) => a.isFeatured && a.id !== heroArticle?.id
            ),
        [daysArticles, heroArticle]
    );

    const groupedArticles = useMemo(
        () =>
            SECTION_ORDER.map((category) => ({
                category,
                articles: daysArticles.filter(
                    (article) => article.category === category
                ),
            })).filter((group) => group.articles.length > 0),
        [daysArticles]
    );

    const goToNextEdition = () => {
        if (!EDITION_DATES.length) return;
        const next = EDITION_DATES.find((date) => date > currentDate);
        setDate(next ?? EDITION_DATES[0]);
    };

    const focusArticle = (article: Article) => {
        onSectionChange(article.category);
        setExpandedId(article.id);
    };

    const handleFeaturedClick = (article: Article) => {
        focusArticle(article);
    };

    const handleHeroReadMore = () => {
        if (heroArticle) {
            focusArticle(heroArticle);
        }
    };

    const openScanViewer = (article: Article) => {
        const page = getArticlePage(article);
        const clampedIndex = Math.max(
            0,
            Math.min(scannedPages.length - 1, (page ?? 1) - 1)
        );
        setViewerState({ open: true, pageIndex: clampedIndex });
    };

    const closeScanViewer = () =>
        setViewerState((prev) => ({ ...prev, open: false }));


    const editionHeaderDate = useMemo(() => {
        try {
            return new Intl.DateTimeFormat("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric",
            }).format(new Date(currentDate));
        } catch {
            return currentDate;
        }
    }, [currentDate]);

    const currentSection = useMemo<SectionId>(() => {
        if (activeSection === "Top") return "Top";
        if (activeSection === "Ads") return "Ads";
        const exists = groupedArticles.some((section) => section.category === activeSection);
        return exists ? activeSection : "Top";
    }, [activeSection, groupedArticles]);

    const currentArticles = useMemo(() => {
        if (currentSection === "Top") return [];
        return groupedArticles.find((g) => g.category === currentSection)?.articles ?? [];
    }, [currentSection, groupedArticles]);

    const mastheadVariants = fadeUp(16);
    const sectionVariants = fadeUp(18);
    const sectionContainer = staggerContainer(0.08, 0.12);

    // Keyboard navigation for articles
    const scrollToArticle = useCallback((index: number) => {
        const article = currentArticles[index];
        if (article) {
            const element = articleRefs.current.get(article.id);
            element?.scrollIntoView({ behavior: "smooth", block: "center" });
        }
    }, [currentArticles]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            // Don't trigger if user is typing in an input
            if (
                event.target instanceof HTMLInputElement ||
                event.target instanceof HTMLTextAreaElement
            ) {
                return;
            }

            // Only handle keyboard navigation when viewing article sections (not Top or Ads)
            if (currentSection === "Top" || currentSection === "Ads") {
                return;
            }

            switch (event.key) {
                case "j": {
                    // Next article
                    event.preventDefault();
                    const nextIndex = Math.min(focusedIndex + 1, currentArticles.length - 1);
                    setFocusedIndex(nextIndex);
                    scrollToArticle(nextIndex);
                    break;
                }
                case "k": {
                    // Previous article
                    event.preventDefault();
                    const prevIndex = Math.max(focusedIndex - 1, 0);
                    setFocusedIndex(prevIndex);
                    scrollToArticle(prevIndex);
                    break;
                }
                case "Enter": {
                    // Expand/collapse focused article
                    event.preventDefault();
                    if (focusedIndex >= 0 && focusedIndex < currentArticles.length) {
                        const article = currentArticles[focusedIndex];
                        setExpandedId((prev) =>
                            prev === article.id ? null : article.id
                        );
                    }
                    break;
                }
                case "Escape": {
                    // Collapse current article
                    event.preventDefault();
                    setExpandedId(null);
                    break;
                }
            }
        };

        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [currentSection, focusedIndex, currentArticles, scrollToArticle]);

    // Register article ref
    const registerArticleRef = useCallback((id: string, element: HTMLElement | null) => {
        if (element) {
            articleRefs.current.set(id, element);
        } else {
            articleRefs.current.delete(id);
        }
    }, []);

    return (
        <div className="w-full pb-20 bg-[var(--color-bg-primary)]">
            <div className="flex flex-col gap-0 min-h-screen">
                <motion.div
                    className="p-8 text-center border-b-4 border-[var(--color-text-primary)] mb-8 max-w-5xl mx-auto w-full"
                    variants={mastheadVariants}
                    initial="hidden"
                    animate="show"
                    transition={TRANSITIONS.base}
                >
                    <h2 className="font-masthead text-6xl uppercase tracking-tighter mb-2">
                        The Transcript
                    </h2>
                    <div className="flex flex-wrap justify-between gap-2 border-t border-b border-[var(--color-text-primary)] py-1 font-mono text-sm uppercase">
                        <span>Vol. 120 · No. 8</span>
                        <span>{editionHeaderDate}</span>
                        <span>Price: 30¢</span>
                    </div>
                </motion.div>

                <div className="flex flex-col max-w-5xl mx-auto w-full px-4 md:px-6">
                    {currentSection === "Top" ? (
                        <motion.div
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
                                    />
                                </motion.div>
                            )}
                            {featuredArticles.length > 0 && (
                                <motion.div variants={sectionVariants} transition={TRANSITIONS.base}>
                                    <FeaturedGrid
                                        articles={featuredArticles}
                                        onArticleClick={handleFeaturedClick}
                                    />
                                </motion.div>
                            )}
                        </motion.div>
                    ) : currentSection === "Ads" ? (
                        <AdsBoard ads={ads} />
                    ) : currentArticles.length > 0 ? (
                        <motion.div
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
                                        onToggle={() =>
                                            setExpandedId((prev) =>
                                                prev === article.id ? null : article.id
                                            )
                                        }
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
                                className="px-6 py-3 border border-current hover:bg-[var(--color-text-primary)] hover:text-[var(--color-text-inverse)] transition-colors uppercase tracking-widest text-sm font-bold"
                            >
                                Jump to Next Available Edition
                            </button>
                        </div>
                    )}
                </div>

                <div className="p-8 flex justify-center mt-10 border-t border-[var(--color-text-primary)] max-w-5xl mx-auto w-full">
                    <button
                        onClick={goToNextEdition}
                        className="group flex items-center gap-3 text-xl font-header hover:underline underline-offset-4"
                    >
                        See Next Edition
                        <motion.span
                            animate={{ x: [0, 5, 0] }}
                            transition={{ repeat: Infinity, duration: 1.5 }}
                        >
                            <ArrowRight />
                        </motion.span>
                    </button>
                </div>

                <div className="pb-8">
                    <div className="flex flex-wrap items-center justify-center gap-3 text-[10px] uppercase tracking-widest text-[var(--color-text-secondary)]">
                        <Link
                            href="/about"
                            className="hover:text-[var(--color-text-primary)] transition-colors"
                        >
                            About
                        </Link>
                        <span aria-hidden="true">•</span>
                        <Link
                            href="/contact"
                            className="hover:text-[var(--color-text-primary)] transition-colors"
                        >
                            Contact
                        </Link>
                        <span aria-hidden="true">•</span>
                        <ThemeModeToggle />
                    </div>
                </div>
            </div>

            <ScanViewer
                key={viewerState.open ? `open-${viewerState.pageIndex}` : "closed"}
                isOpen={viewerState.open}
                pages={scannedPages}
                activeIndex={viewerState.pageIndex}
                onClose={closeScanViewer}
                onSelectPage={(index) =>
                    setViewerState({ open: true, pageIndex: index })
                }
            />
        </div>
    );
};
