"use client";

import React from "react";
import { motion } from "framer-motion";
import { fadeUp, staggerContainer, TRANSITIONS } from "@/shared/motion/motionTokens";
import { HeroSection } from "../HeroSection";
import { FeaturedGrid } from "../FeaturedGrid";
import { ExpandedArticleSlot } from "./ExpandedArticleSlot";
import type { TopStoriesVariantProps } from "./TopStoriesVariantProps";

const sectionVariants = fadeUp(18);
const sectionContainer = staggerContainer(0.08, 0.12);

export const TopStoriesDefault: React.FC<TopStoriesVariantProps> = ({
  heroArticle,
  featuredArticles,
  topExpandedArticle,
  focusedIndex,
  topArticles,
  onHeroReadMore,
  onFeaturedClick,
  onExpandedToggle,
  onViewOriginal,
  currentSection,
  topExpandedRef,
}) => (
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
          onReadMore={onHeroReadMore}
          isFocused={focusedIndex === 0 && currentSection === "Top"}
        />
      </motion.div>
    )}
    {featuredArticles.length > 0 && (
      <motion.div variants={sectionVariants} transition={TRANSITIONS.base}>
        <FeaturedGrid
          articles={featuredArticles}
          onArticleClick={onFeaturedClick}
          focusedId={
            currentSection === "Top" && focusedIndex > 0
              ? topArticles[focusedIndex]?.id ?? null
              : null
          }
        />
      </motion.div>
    )}
    <ExpandedArticleSlot
      article={topExpandedArticle}
      expandedRef={topExpandedRef}
      onToggle={onExpandedToggle}
      onViewOriginal={onViewOriginal}
    />
  </motion.div>
);
