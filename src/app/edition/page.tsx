"use client";

import React, { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { TimeControls } from "@/features/time-controls";
import { NavigationSidebar } from "@/features/navigation";
import { MobileNav } from "@/features/navigation/components/MobileNav";
import { NewsFeed, getClosestContext, useEditionArticles } from "@/features/news-feed";
import { ContextSidebar } from "@/features/context-panel";
import { useArchive } from "@/features/archive";
import { PageShell } from "@/shared";
import { fadeUp, TRANSITIONS } from "@/shared/motion/motionTokens";
import { SkeletonFeed } from "@/src/components/ui/Skeleton";

import type { SectionId } from "@/features/news-feed";
import { SECTION_ORDER } from "@/features/news-feed/components/NewsFeed";

export default function Edition() {
  const { currentDate } = useArchive();
  return <EditionBody key={currentDate} currentDate={currentDate} />;
}

function EditionBody({ currentDate }: { currentDate: string }) {
  const [activeSection, setActiveSection] = useState<SectionId>("Top");
  const { articles, isLoading } = useEditionArticles(currentDate);

  const context = useMemo(
    () => getClosestContext(currentDate),
    [currentDate]
  );

  const articlesForDate = articles; // Already filtered by date from API

  const sections = useMemo(() => {
    const counts = SECTION_ORDER.map((category) => ({
      id: category as SectionId,
      label: category,
      count: articlesForDate.filter((article) => article.category === category).length,
    }));

    // Prioritize real ads count over mock ads count
    const realAdsCount = counts.find((item) => item.id === "Ads")?.count ?? 0;
    const adsCount = realAdsCount > 0 ? realAdsCount : (context.ads?.length ?? 0);

    const filtered = counts.filter((item) => item.id !== "Ads" && item.count > 0);

    const result = [
      { id: "Top" as SectionId, label: "Top Stories" },
      ...filtered,
    ];

    if (adsCount > 0) {
      result.push({ id: "Ads" as SectionId, label: "Ads", count: adsCount });
    }

    return result;
  }, [articlesForDate, context]);

  const handleSectionChange = (sectionId: SectionId) => {
    setActiveSection(sectionId);
  };

  return (
    <PageShell variant="default" hasHeader>
      <TimeControls />

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
            {isLoading ? (
              <SkeletonFeed count={4} />
            ) : (
              <NewsFeed
                key={`${currentDate}-${activeSection}`}
                articles={articles}
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

      {/* Mobile Bottom Navigation */}
      <MobileNav
        sections={sections}
        activeSection={activeSection}
        onSelect={handleSectionChange}
      />
    </PageShell>
  );
}
