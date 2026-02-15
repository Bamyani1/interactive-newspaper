"use client";

import React, { useMemo, useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { TimeControls } from "@/features/time-controls";
import { NavigationSidebar } from "@/features/navigation";
import { MobileNav } from "@/features/navigation/components/MobileNav";
import {
    NewsFeed,
    useEditionArticles,
} from "@/features/news-feed";
import { ContextSidebar } from "@/features/context-panel";
import { useArchive } from "@/features/archive";
import { PageShell, SkeletonFeed } from "@/shared";
import { fadeUp, TRANSITIONS } from "@/shared/motion/motionTokens";

import type { SectionId } from "@/src/types";
import { SECTION_ORDER } from "@/features/news-feed/components/NewsFeed";

export default function EditionDatePage() {
    const params = useParams<{ date: string }>();
    const router = useRouter();
    const { setDate, editions, hasEditions, isLoading: isLoadingEditions } = useArchive();

    const dateParam = params.date;

    // Sync URL date into ArchiveContext
    useEffect(() => {
        if (dateParam) {
            setDate(dateParam);
        }
    }, [dateParam, setDate]);

    // Redirect to latest edition if date not found
    useEffect(() => {
        if (isLoadingEditions || !hasEditions) return;
        if (dateParam && !editions.includes(dateParam)) {
            router.replace(`/edition/${editions[0]}`);
        }
    }, [dateParam, editions, hasEditions, isLoadingEditions, router]);

    const handleDateChange = (newDate: string) => {
        router.push(`/edition/${newDate}`);
    };

    return (
        <EditionBody
            key={dateParam ?? "no-edition"}
            currentDate={dateParam}
            editions={editions}
            onDateChange={handleDateChange}
            hasEditions={hasEditions}
            isLoadingEditions={isLoadingEditions}
        />
    );
}

interface EditionBodyProps {
    currentDate: string | null;
    editions: string[];
    onDateChange: (date: string) => void;
    hasEditions: boolean;
    isLoadingEditions: boolean;
}

function EmptyState() {
    return (
        <div className="mx-auto w-full max-w-4xl px-6 py-16">
            <div className="border border-[var(--stroke-accent-soft)] bg-[var(--color-bg-secondary)]/70 p-8">
                <h2 className="font-header text-3xl uppercase tracking-wide mb-4">
                    No Editions Loaded
                </h2>
                <p className="text-[var(--color-text-secondary)] mb-3">
                    This archive is currently clean and ready for real material.
                </p>
                <p className="text-[var(--color-text-secondary)] mb-6">
                    Import at least one edition, seed the database, then refresh this page.
                </p>
                <div className="font-mono text-xs uppercase tracking-widest space-y-2 text-[var(--color-text-primary)]">
                    <p>1. Run `npm run prepare:real-material`</p>
                    <p>2. Run pipeline scripts for your real scans</p>
                    <p>3. Seed articles and reopen this page</p>
                </div>
            </div>
        </div>
    );
}

function EditionBody({
    currentDate,
    editions,
    onDateChange,
    hasEditions,
    isLoadingEditions,
}: EditionBodyProps) {
    const [activeSection, setActiveSection] = useState<SectionId>("Top");
    const {
        articles,
        ads,
        hasActiveEdition,
        isLoading: isLoadingArticles,
    } = useEditionArticles(currentDate);

    const articlesForDate = articles;
    const isLoading = isLoadingEditions || isLoadingArticles;

    const sections = useMemo(() => {
        const counts = SECTION_ORDER.map((category) => ({
            id: category as SectionId,
            label: category,
            count: articlesForDate.filter((article) => article.category === category).length,
        }));

        const filtered = counts.filter((item) => item.count > 0);

        const result: { id: SectionId; label: string; count?: number }[] = [
            { id: "Top" as SectionId, label: "Top Stories" },
            ...filtered,
        ];

        if (ads.length > 0) {
            result.push({ id: "Ads" as SectionId, label: "Ads", count: ads.length });
        }

        return result;
    }, [articlesForDate, ads]);

    const handleSectionChange = (sectionId: SectionId) => {
        setActiveSection(sectionId);
    };

    return (
        <PageShell variant="default" hasHeader>
            <TimeControls />

            {!isLoadingEditions && !hasEditions ? (
                <main className="min-h-screen w-full">
                    <EmptyState />
                </main>
            ) : (
                <motion.main
                    className="min-h-screen w-full lg:min-h-0 lg:h-[calc(100vh-var(--header-height))] lg:overflow-hidden"
                    variants={fadeUp(12)}
                    initial="hidden"
                    animate="show"
                    transition={TRANSITIONS.base}
                >
                    <div className="grid grid-cols-1 lg:grid-cols-[var(--sidebar-nav-width)_1fr_var(--sidebar-context-width)] w-full min-h-full lg:h-full">
                        {/* Left Sidebar: Navigation */}
                        <div className="hidden lg:block lg:h-full border-r border-[var(--color-accent)]/50">
                            <NavigationSidebar
                                sections={sections}
                                activeSection={activeSection}
                                onSelect={handleSectionChange}
                            />
                        </div>

                        {/* Center: Main Feed */}
                        <div className="lg:overflow-y-auto lg:h-full scrollbar-hide pb-20 lg:pb-0">
                            {isLoading || !hasActiveEdition ? (
                                <SkeletonFeed count={4} />
                            ) : (
                                <NewsFeed
                                    key={currentDate ?? "no-edition"}
                                    articles={articles}
                                    ads={ads}
                                    editionDate={currentDate}
                                    editions={editions}
                                    onDateChange={onDateChange}
                                    activeSection={activeSection}
                                    onSectionChange={handleSectionChange}
                                />
                            )}
                        </div>

                        {/* Right Sidebar: Context */}
                        <div className="lg:h-full lg:border-l border-[var(--color-accent)]/50 border-t lg:border-t-0">
                            <ContextSidebar />
                        </div>
                    </div>
                </motion.main>
            )}

            {/* Mobile Bottom Navigation */}
            <MobileNav
                sections={sections}
                activeSection={activeSection}
                onSelect={handleSectionChange}
            />
        </PageShell>
    );
}
