"use client";

import React from "react";
import { motion } from "framer-motion";
import Image from "next/image";
import { fadeUp, staggerContainer, TRANSITIONS } from "@/shared/motion/motionTokens";
import { ExpandedArticleSlot } from "./ExpandedArticleSlot";
import type { TopStoriesVariantProps } from "./TopStoriesVariantProps";

const sectionVariants = fadeUp(18);
const rowVariants = fadeUp(10);
const splitContainer = staggerContainer(0.08, 0.12);

export const TopStoriesColumnSplit: React.FC<TopStoriesVariantProps> = ({
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
}) => {
  const hasHeroImage = heroArticle && heroArticle.imageUrls.length > 0;

  return (
    <motion.div
      key="column-split"
      className="flex flex-col gap-6"
      variants={splitContainer}
      initial="hidden"
      animate="show"
    >
      {/* ── Two-column layout ── */}
      <div className="flex flex-col md:flex-row gap-0">
        {/* Left column: Hero (60%) */}
        {heroArticle && (
          <motion.section
            variants={sectionVariants}
            transition={TRANSITIONS.base}
            className={`md:w-[60%] md:border-r border-[var(--color-border-default)] cursor-pointer group ${
              focusedIndex === 0 && currentSection === "Top"
                ? "ring-2 ring-[var(--color-accent)] ring-offset-2 ring-offset-[var(--color-bg-primary)]"
                : ""
            }`}
            onClick={onHeroReadMore}
          >
            {hasHeroImage && (
              <div className="relative w-full aspect-[3/2] overflow-hidden">
                <Image
                  src={heroArticle.imageUrls[0]}
                  alt={heroArticle.headline}
                  fill
                  className="object-cover transition-transform duration-500 group-hover:scale-[1.02]"
                  priority
                />
              </div>
            )}

            <div className="p-4 md:p-5 md:pr-6 space-y-2">
              {heroArticle.imageCaption && hasHeroImage && (
                <p className="font-body text-xs italic text-[var(--color-text-secondary)] opacity-50">
                  {heroArticle.imageCaption}
                </p>
              )}

              <span className="inline-block font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--color-accent)] font-bold">
                {heroArticle.category}
              </span>

              <h1 className="font-header text-2xl md:text-3xl text-[var(--color-text-primary)] leading-snug group-hover:text-[var(--color-accent)] transition-colors">
                {heroArticle.headline}
              </h1>

              {heroArticle.byline && (
                <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--color-text-secondary)] opacity-60">
                  By {heroArticle.byline}
                </p>
              )}

              <p className="font-body text-base leading-relaxed text-[var(--color-text-secondary)] line-clamp-3">
                {heroArticle.summary}
              </p>

              <div className="pt-2">
                <span className="font-mono text-xs uppercase tracking-widest text-[var(--color-text-secondary)] group-hover:text-[var(--color-accent)] transition-colors">
                  Read Full Story &darr;
                </span>
              </div>
            </div>
          </motion.section>
        )}

        {/* Right column: Featured stack (40%) */}
        {featuredArticles.length > 0 && (
          <motion.section
            variants={sectionVariants}
            transition={TRANSITIONS.base}
            className="md:w-[40%] divide-y divide-[var(--color-border-default)]"
          >
            {featuredArticles.map((article, index) => {
              const hasImage = article.imageUrls.length > 0;
              const isFocused =
                currentSection === "Top" &&
                focusedIndex > 0 &&
                topArticles[focusedIndex]?.id === article.id;

              return (
                <motion.button
                  key={article.id}
                  variants={rowVariants}
                  transition={TRANSITIONS.base}
                  onClick={() => onFeaturedClick(article)}
                  className={`w-full flex items-start gap-3 p-3 md:p-4 text-left cursor-pointer transition-colors hover:bg-[var(--color-bg-primary)] ${
                    isFocused
                      ? "ring-2 ring-inset ring-[var(--color-accent)]"
                      : ""
                  }`}
                >
                  {hasImage && (
                    <div className="shrink-0 relative w-16 h-16 overflow-hidden border border-[var(--featured-card-border)]">
                      <Image
                        src={article.imageUrls[0]}
                        alt={article.headline}
                        fill
                        className="object-cover"
                      />
                    </div>
                  )}
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--color-accent)] font-bold">
                      {article.category}
                    </span>
                    <h3 className="font-header text-sm leading-snug text-[var(--color-text-primary)] line-clamp-2">
                      {article.headline}
                    </h3>
                    {article.byline && (
                      <p className="font-body text-[10px] text-[var(--color-text-secondary)] opacity-60 truncate">
                        {article.byline.split(",")[0]}
                      </p>
                    )}
                  </div>
                </motion.button>
              );
            })}
          </motion.section>
        )}
      </div>

      {/* ── Expanded article slot ── */}
      <ExpandedArticleSlot
        article={topExpandedArticle}
        expandedRef={topExpandedRef}
        onToggle={onExpandedToggle}
        onViewOriginal={onViewOriginal}
      />
    </motion.div>
  );
};
