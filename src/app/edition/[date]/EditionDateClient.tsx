"use client";

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { TimeControls } from "@/features/time-controls";
import { NavigationSidebar } from "@/features/navigation";
import { ContextSidebar } from "@/features/context-panel/components/ContextSidebar";
import { MobileNav } from "@/features/navigation/components/MobileNav";
import { NewsFeed } from "@/features/news-feed";
import { useArchive } from "@/features/archive";
import { PageShell } from "@/shared";
import {
    consumeExplicitEditionNavigation,
    markExplicitEditionNavigation,
} from "@/shared/navigation/editionNavigation";
import { editionSwapVariants } from "@/shared/motion/motionTokens";

import type { Article, VintageAd, SectionId } from "@/src/types";
import { SECTION_ORDER } from "@/features/news-feed/components/NewsFeed";

interface EditionDateClientProps {
    currentDate: string;
    articles: Article[];
    ads: VintageAd[];
    publicationInfo: string;
}

// Keep positions outside the route component so a dynamic-segment remount does
// not discard the edition the browser may return to.
const editionFeedScrollPositions = new Map<string, number>();

export function EditionDateClient({
    currentDate,
    articles,
    ads,
    publicationInfo,
}: EditionDateClientProps) {
    const router = useRouter();
    const { editions } = useArchive();
    const [activeSection, setActiveSection] = useState<SectionId>("Top");
    const [isEditionPending, startEditionNavigation] = useTransition();

    const handleDateChange = useCallback((newDate: string) => {
        if (newDate === currentDate) return;
        markExplicitEditionNavigation(newDate);
        router.prefetch(`/edition/${newDate}`);
        startEditionNavigation(() => {
            router.push(`/edition/${newDate}`);
        });
    }, [currentDate, router]);

    useEffect(() => {
        const currentIndex = editions.indexOf(currentDate);
        if (currentIndex === -1 || editions.length < 2) return;
        const previous = editions[(currentIndex - 1 + editions.length) % editions.length];
        const next = editions[(currentIndex + 1) % editions.length];
        router.prefetch(`/edition/${previous}`);
        router.prefetch(`/edition/${next}`);
    }, [currentDate, editions, router]);

    const displayAds = useMemo(
        () => ads.filter(a => a.adType ? a.adType === "display" : a.body.length >= 200),
        [ads],
    );
    const classifiedAds = useMemo(
        () => ads.filter(a => a.adType ? a.adType === "classified" : (a.body.length >= 80 && a.body.length < 200)),
        [ads],
    );

    const sections = useMemo(() => {
        const counts = SECTION_ORDER.map((category) => ({
            id: category as SectionId,
            label: category,
            count: articles.filter((article) => article.category === category).length,
        }));

        const filtered = counts.filter((item) => item.count > 0);

        const result: { id: SectionId; label: string; count?: number }[] = [
            { id: "Top" as SectionId, label: "Top Stories" },
            ...filtered,
        ];

        if (displayAds.length > 0) {
            result.push({ id: "Ads" as SectionId, label: "Ads", count: displayAds.length });
        }
        if (classifiedAds.length > 0) {
            result.push({ id: "Classifieds" as SectionId, label: "Classifieds", count: classifiedAds.length });
        }

        return result;
    }, [articles, displayAds, classifiedAds]);

    const handleSectionChange = (sectionId: SectionId) => {
        setActiveSection(sectionId);
    };

    const feedRef = useRef<HTMLDivElement>(null);
    const previousSectionRef = useRef<SectionId>(activeSection);

    useLayoutEffect(() => {
        const feed = feedRef.current;
        if (!feed) return undefined;

        const isExplicitNavigation = consumeExplicitEditionNavigation(currentDate);
        feed.scrollTop = isExplicitNavigation
            ? 0
            : editionFeedScrollPositions.get(currentDate) ?? 0;

        const persistScrollPosition = () => {
            editionFeedScrollPositions.set(currentDate, feed.scrollTop);
        };
        persistScrollPosition();
        feed.addEventListener("scroll", persistScrollPosition, { passive: true });

        return () => {
            persistScrollPosition();
            feed.removeEventListener("scroll", persistScrollPosition);
        };
    }, [currentDate]);

    useLayoutEffect(() => {
        if (previousSectionRef.current === activeSection) return;
        previousSectionRef.current = activeSection;
        if (feedRef.current) {
            feedRef.current.scrollTop = 0;
        }
    }, [activeSection]);

    const [direction, setDirection] = useState(1);
    const prevDateRef = useRef<string | null>(null);
    useEffect(() => {
        if (prevDateRef.current && currentDate) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- derives direction from previous vs current date
            setDirection(currentDate > prevDateRef.current ? 1 : -1);
        }
        prevDateRef.current = currentDate;
    }, [currentDate]);

    return (
        <PageShell variant="default" hasHeader className="edition-background-shell">
            <div className="paper-texture-overlay" aria-hidden="true" />
            <TimeControls currentDate={currentDate} />

            <main id="main-content" tabIndex={-1} className="min-h-screen w-full lg:min-h-0 lg:h-[calc(100vh-var(--header-offset-total))] lg:overflow-hidden">
                <div className="grid grid-cols-1 lg:grid-cols-[var(--sidebar-nav-width)_1fr_var(--sidebar-context-width)] w-full min-h-full lg:h-full">
                    {/* Left Sidebar: Navigation */}
                    <div className="hidden lg:block lg:h-full lg:overflow-y-auto lg:min-h-0 border-r border-[var(--color-accent)]/50">
                        <NavigationSidebar
                            sections={sections}
                            activeSection={activeSection}
                            onSelect={handleSectionChange}
                        />
                    </div>

                    {/* Main Feed */}
                    <div ref={feedRef} className="lg:overflow-y-auto lg:h-full scrollbar-hide pb-20 lg:pb-0">
                        <div style={{ display: "grid" }}>
                            <AnimatePresence initial={false} mode="sync" custom={direction}>
                                <motion.div
                                    key={currentDate}
                                    style={{ gridArea: "1 / 1" }}
                                    custom={direction}
                                    variants={editionSwapVariants}
                                    initial="enter"
                                    animate="center"
                                    exit="exit"
                                >
                                    <NewsFeed
                                        articles={articles}
                                        displayAds={displayAds}
                                        classifiedAds={classifiedAds}
                                        editionDate={currentDate}
                                        editions={editions}
                                        onDateChange={handleDateChange}
                                        activeSection={activeSection}
                                        onSectionChange={handleSectionChange}
                                        publicationInfo={publicationInfo}
                                        isEditionPending={isEditionPending}
                                    />
                                </motion.div>
                            </AnimatePresence>
                        </div>
                    </div>

                    {/* Right Sidebar: Weather + Player */}
                    <div className="hidden lg:block lg:h-full lg:overflow-hidden border-l border-[var(--color-accent)]/50">
                        <ContextSidebar currentDate={currentDate} />
                    </div>
                </div>
            </main>

            {/* Mobile Bottom Navigation */}
            <MobileNav
                sections={sections}
                activeSection={activeSection}
                onSelect={handleSectionChange}
            />
        </PageShell>
    );
}
