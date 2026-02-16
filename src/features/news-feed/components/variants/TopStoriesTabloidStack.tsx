"use client";

import React from "react";
import { motion } from "framer-motion";
import Image from "next/image";
import { fadeUp, staggerContainer, TRANSITIONS } from "@/shared/motion/motionTokens";
import { ExpandedArticleSlot } from "./ExpandedArticleSlot";
import type { TopStoriesVariantProps } from "./TopStoriesVariantProps";

const sectionVariants = fadeUp(18);
const rowVariants = fadeUp(10);
const sectionContainer = staggerContainer(0.06, 0.1);

export const TopStoriesTabloidStack: React.FC<TopStoriesVariantProps> = ({
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
  const heroHasImage = heroArticle && heroArticle.imageUrls.length > 0;
  const heroAuthor = heroArticle?.byline || null;
  const heroPage = heroArticle?.page || null;

  return (
    <motion.div
      key="top-section-tabloid"
      className="flex flex-col gap-6"
      variants={sectionContainer}
      initial="hidden"
      animate="show"
    >
      {/* ── Hero: full-width image stacked above text ── */}
      {heroArticle && (
        <motion.section
          variants={sectionVariants}
          transition={TRANSITIONS.base}
          className={`relative w-full bg-[var(--featured-card-bg)] border border-[var(--featured-card-border)] border-b-2 border-b-[var(--color-accent)] overflow-hidden ${
            focusedIndex === 0 && currentSection === "Top"
              ? "ring-2 ring-[var(--color-accent)] ring-offset-2 ring-offset-[var(--color-bg-primary)]"
              : ""
          }`}
        >
          {/* Full-width hero image */}
          {heroHasImage && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.08 }}
              className="relative w-full aspect-[16/9] border-b border-[var(--color-border-default)]"
            >
              <Image
                src={heroArticle.imageUrls[0]}
                alt={heroArticle.headline}
                fill
                className="object-cover"
                priority
              />
            </motion.div>
          )}

          {/* Text content below image */}
          <div className="px-5 md:px-6 py-5 md:py-6 space-y-2">
            {/* Image caption */}
            {heroHasImage && heroArticle.imageCaption && (
              <p className="font-body text-xs italic text-[var(--color-text-secondary)] opacity-60 leading-snug -mt-1 mb-2">
                {heroArticle.imageCaption}
              </p>
            )}

            {/* Meta strip */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              className="flex items-center gap-2 flex-wrap font-mono text-[10px] uppercase tracking-[0.15em]"
            >
              <span className="text-[var(--color-accent)] font-bold">
                {heroArticle.category}
              </span>
              <span aria-hidden="true" className="text-[var(--color-text-secondary)]">
                ·
              </span>
              <span className="text-[var(--color-text-secondary)]">
                {heroArticle.date}
              </span>
              {heroPage && (
                <>
                  <span aria-hidden="true" className="text-[var(--color-text-secondary)]">
                    ·
                  </span>
                  <span className="text-[var(--color-text-secondary)]">
                    Pg. {heroPage}
                  </span>
                </>
              )}
            </motion.div>

            {/* Headline */}
            <motion.h1
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="font-header text-2xl md:text-3xl lg:text-4xl text-[var(--color-text-primary)] leading-snug"
            >
              {heroArticle.headline}
            </motion.h1>

            {/* Byline */}
            {heroAuthor && (
              <motion.p
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.22 }}
                className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--color-text-secondary)] opacity-60"
              >
                By {heroAuthor}
              </motion.p>
            )}

            {/* Summary */}
            <motion.p
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }}
              className="font-body text-base md:text-lg leading-relaxed text-[var(--color-text-secondary)] line-clamp-3"
            >
              {heroArticle.summary}
            </motion.p>

            {/* Read more */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="flex justify-end pt-2"
            >
              <button
                onClick={onHeroReadMore}
                className="font-mono text-xs uppercase tracking-widest text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] transition-colors"
              >
                Read Full Story &darr;
              </button>
            </motion.div>
          </div>
        </motion.section>
      )}

      {/* ── Featured articles: horizontal text-only rows ── */}
      {featuredArticles.length > 0 && (
        <motion.section
          variants={sectionVariants}
          transition={TRANSITIONS.base}
          className="w-full bg-[var(--featured-card-bg)] border border-[var(--featured-card-border)]"
        >
          <motion.div
            variants={staggerContainer(0.04, 0.06)}
            initial="hidden"
            animate="show"
            className="divide-y divide-[var(--color-border-default)]"
          >
            {featuredArticles.map((article, index) => {
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
                  className={`w-full flex items-center gap-4 px-4 md:px-5 py-3 md:py-4 text-left hover:bg-[var(--color-bg-primary)] transition-colors ${
                    isFocused
                      ? "ring-2 ring-inset ring-[var(--color-accent)]"
                      : ""
                  }`}
                >
                  {/* Category tag */}
                  <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-accent)] font-bold w-16 md:w-20">
                    {article.category}
                  </span>

                  {/* Headline */}
                  <span className="flex-1 font-header text-sm md:text-base text-[var(--color-text-primary)] leading-snug line-clamp-1">
                    {article.headline}
                  </span>

                  {/* Byline */}
                  {article.byline && (
                    <span className="hidden sm:block shrink-0 font-body text-xs text-[var(--color-text-secondary)] opacity-60 max-w-[140px] truncate">
                      {article.byline}
                    </span>
                  )}

                  {/* Page number */}
                  {article.page && (
                    <span className="shrink-0 font-mono text-[10px] text-[var(--color-text-secondary)] opacity-50 uppercase tracking-wider">
                      Pg. {article.page}
                    </span>
                  )}
                </motion.button>
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
