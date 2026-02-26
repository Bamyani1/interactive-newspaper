"use client";

import React, { useState, useMemo } from "react";
import { PageShell } from "@/shared";
import { TimeControls } from "@/features/time-controls";
import { NavigationSidebar } from "@/features/navigation";
import { ContextSidebar } from "@/features/context-panel/components/ContextSidebar";
import { MobileNav } from "@/features/navigation/components/MobileNav";
import { NewsFeed } from "@/features/news-feed";
import { SECTION_ORDER } from "@/features/news-feed/components/NewsFeed";
import type { Article, VintageAd, SectionId } from "@/src/types";

interface GoldenEditionClientProps {
    articles: Article[];
    displayAds: VintageAd[];
    classifiedAds: VintageAd[];
    editionDate: string;
    publicationInfo: string;
}

export function GoldenEditionClient({
    articles,
    displayAds,
    classifiedAds,
    editionDate,
    publicationInfo
}: GoldenEditionClientProps) {
    const [activeSection, setActiveSection] = useState<SectionId>("Top");

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
                    <div className="lg:overflow-y-auto lg:h-full scrollbar-hide pb-20 lg:pb-0 relative">
                        {/* Golden Dataset Banner */}
                        <div className="sticky top-0 z-50 bg-[#ffd700] text-black text-center font-bold font-mono uppercase tracking-widest text-xs py-1 border-b-2 border-black">
                            Viewing Golden Verified Dataset (No Database)
                        </div>

                        <NewsFeed
                            articles={articles}
                            displayAds={displayAds}
                            classifiedAds={classifiedAds}
                            editionDate={editionDate}
                            editions={[editionDate]} // Lock to just this edition
                            onDateChange={() => { }} // Disabled
                            activeSection={activeSection}
                            onSectionChange={handleSectionChange}
                            publicationInfo={publicationInfo}
                        />
                    </div>

                    {/* Right Sidebar: Context */}
                    <div className="hidden lg:block lg:h-full lg:overflow-hidden border-l border-[var(--color-accent)]/50">
                        <ContextSidebar currentDate={editionDate} />
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
