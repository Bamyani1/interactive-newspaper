"use client";

import React from "react";
import { motion } from "framer-motion";
import { fadeUp, staggerContainer, TRANSITIONS } from "@/shared/motion/motionTokens";
import { ExpandedArticleSlot } from "./ExpandedArticleSlot";
import type { TopStoriesVariantProps } from "./TopStoriesVariantProps";

const sectionVariants = fadeUp(18);
const headlineVariants = fadeUp(24);
const metaVariants = fadeUp(12);
const sectionContainer = staggerContainer(0.1, 0.12);
const featuredContainer = staggerContainer(0.05, 0.2);

export const TopStoriesBroadside: React.FC<TopStoriesVariantProps> = ({
  heroArticle,
  featuredArticles,
  topExpandedArticle,
  expandedId,
  focusedIndex,
  topArticles,
  onHeroReadMore,
  onFeaturedClick,
  onExpandedToggle,
  onViewOriginal,
  currentSection,
  topExpandedRef,
}) => {
  const heroAuthor = heroArticle?.byline || null;

  return (
    <motion.div
      key="top-section-broadside"
      className="flex flex-col gap-8"
      variants={sectionContainer}
      initial="hidden"
      animate="show"
    >
      {/* ── Hero: Broadside poster layout ── */}
      {heroArticle && (
        <motion.section
          variants={sectionVariants}
          transition={TRANSITIONS.base}
          className={`w-full max-w-2xl mx-auto text-center px-4 md:px-6 py-8 md:py-12 ${
            focusedIndex === 0 && currentSection === "Top"
              ? "ring-2 ring-[var(--color-accent)] ring-offset-2 ring-offset-[var(--color-bg-primary)]"
              : ""
          }`}
        >
          {/* Top decorative rule */}
          <motion.div
            variants={metaVariants}
            transition={TRANSITIONS.base}
            className="w-full border-t border-[var(--color-border-accent)] mb-6 md:mb-8"
            aria-hidden="true"
          />

          {/* Headline */}
          <motion.h1
            variants={headlineVariants}
            transition={TRANSITIONS.slow}
            className="font-header text-4xl md:text-6xl uppercase tracking-tight leading-[1.05] text-[var(--color-text-primary)]"
          >
            {heroArticle.headline}
          </motion.h1>

          {/* Bottom decorative rule */}
          <motion.div
            variants={metaVariants}
            transition={TRANSITIONS.base}
            className="w-full border-t border-[var(--color-border-accent)] mt-6 md:mt-8 mb-4 md:mb-5"
            aria-hidden="true"
          />

          {/* Category and date in small caps */}
          <motion.div
            variants={metaVariants}
            transition={TRANSITIONS.base}
            className="flex items-center justify-center gap-3 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-text-secondary)]"
          >
            <span className="text-[var(--color-accent)] font-bold">
              {heroArticle.category}
            </span>
            <span aria-hidden="true" className="text-[var(--color-text-secondary)] opacity-40">
              |
            </span>
            <span>{heroArticle.date}</span>
          </motion.div>

          {/* Byline */}
          {heroAuthor && (
            <motion.p
              variants={metaVariants}
              transition={TRANSITIONS.base}
              className="mt-3 font-body text-sm italic text-[var(--color-text-secondary)] opacity-70"
            >
              By {heroAuthor}
            </motion.p>
          )}

          {/* Summary in narrow column */}
          <motion.p
            variants={metaVariants}
            transition={TRANSITIONS.base}
            className="mt-5 md:mt-6 max-w-lg mx-auto font-body text-base md:text-lg leading-relaxed text-[var(--color-text-secondary)] text-center"
          >
            {heroArticle.summary}
          </motion.p>

          {/* Read More button */}
          <motion.div
            variants={metaVariants}
            transition={TRANSITIONS.base}
            className="mt-5"
          >
            <button
              onClick={onHeroReadMore}
              className="font-mono text-xs uppercase tracking-[0.15em] text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] transition-colors"
            >
              Read More &#9662;
            </button>
          </motion.div>
        </motion.section>
      )}

      {/* ── Featured: horizontal headline links separated by pipes ── */}
      {featuredArticles.length > 0 && (
        <motion.section
          variants={sectionVariants}
          transition={TRANSITIONS.base}
          className="w-full max-w-2xl mx-auto"
        >
          <motion.div
            variants={featuredContainer}
            initial="hidden"
            animate="show"
            className="flex flex-wrap items-center justify-center gap-x-1 gap-y-2 px-4"
          >
            {featuredArticles.map((article, index) => {
              const isFocused =
                currentSection === "Top" &&
                focusedIndex > 0 &&
                topArticles[focusedIndex]?.id === article.id;

              return (
                <React.Fragment key={article.id}>
                  {index > 0 && (
                    <span
                      aria-hidden="true"
                      className="text-[var(--color-text-secondary)] opacity-30 mx-1 select-none"
                    >
                      |
                    </span>
                  )}
                  <motion.button
                    variants={metaVariants}
                    transition={TRANSITIONS.base}
                    onClick={() => onFeaturedClick(article)}
                    className={`font-header text-sm leading-snug text-[var(--color-text-primary)] hover:text-[var(--color-accent)] cursor-pointer transition-colors ${
                      isFocused
                        ? "text-[var(--color-accent)] underline underline-offset-2"
                        : ""
                    }`}
                  >
                    {article.headline}
                  </motion.button>
                </React.Fragment>
              );
            })}
          </motion.div>
        </motion.section>
      )}

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
