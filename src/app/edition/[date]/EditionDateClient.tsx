"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { TimeControls } from "@/features/time-controls";
import { NavigationSidebar } from "@/features/navigation";
import { ContextSidebar } from "@/features/context-panel/components/ContextSidebar";
import { MobileNav } from "@/features/navigation/components/MobileNav";
import { NewsFeed } from "@/features/news-feed";
import { useArchive } from "@/features/archive";
import { PageShell } from "@/shared";
import { editionSwapVariants } from "@/shared/motion/motionTokens";

import type { Article, VintageAd, SectionId } from "@/src/types";
import { SECTION_ORDER } from "@/features/news-feed/components/NewsFeed";

interface EditionDateClientProps {
    currentDate: string;
    articles: Article[];
    ads: VintageAd[];
    publicationInfo: string;
}

export function EditionDateClient({
    currentDate,
    articles,
    ads,
    publicationInfo,
}: EditionDateClientProps) {
    const router = useRouter();
    const { setDate, editions } = useArchive();
    const [activeSection, setActiveSection] = useState<SectionId>("Top");

    useEffect(() => {
        setDate(currentDate);
    }, [currentDate, setDate]);

    const handleDateChange = (newDate: string) => {
        router.push(`/edition/${newDate}`);
    };

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

    useEffect(() => {
        if (feedRef.current) {
            feedRef.current.scrollTop = 0;
        }
    }, [activeSection, currentDate]);

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
            <TimeControls />

            <main className="min-h-screen w-full lg:min-h-0 lg:h-[calc(100vh-var(--header-offset-total))] lg:overflow-hidden">
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
                            <AnimatePresence mode="sync" custom={direction}>
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
