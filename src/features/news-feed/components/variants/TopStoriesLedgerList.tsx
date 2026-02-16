"use client";
import React from "react";
import { motion } from "framer-motion";
import { fadeUp, staggerContainer, TRANSITIONS } from "@/shared/motion/motionTokens";
import { ExpandedArticleSlot } from "./ExpandedArticleSlot";
import type { TopStoriesVariantProps } from "./TopStoriesVariantProps";

const rowVariants = fadeUp(10);
const ledgerContainer = staggerContainer(0.05, 0.08);

export const TopStoriesLedgerList: React.FC<TopStoriesVariantProps> = ({
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
  // Build rows: hero is #1, featured fill #2, #3, #4
  const rows = [
    ...(heroArticle ? [{ article: heroArticle, index: 0, isHero: true }] : []),
    ...featuredArticles.map((article, i) => ({
      article,
      index: (heroArticle ? 1 : 0) + i,
      isHero: false,
    })),
  ];

  return (
    <motion.div
      key="top-section-ledger"
      className="flex flex-col gap-6"
      variants={ledgerContainer}
      initial="hidden"
      animate="show"
    >
      {/* ── Ledger table ── */}
      <motion.div
        variants={rowVariants}
        transition={TRANSITIONS.base}
        className="w-full bg-[var(--featured-card-bg)] border border-[var(--featured-card-border)] overflow-hidden"
      >
        {/* Header row */}
        <div
          className="grid items-center px-4 md:px-5 py-2 border-b-2 border-[var(--color-accent)]"
          style={{ gridTemplateColumns: "48px 1fr 120px 48px" }}
        >
          <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--color-text-secondary)]">
            #
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--color-text-secondary)]">
            Headline
          </span>
          <span className="hidden sm:block font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--color-text-secondary)] text-right">
            By
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--color-text-secondary)] text-right">
            Pg.
          </span>
        </div>

        {/* Data rows */}
        <motion.div
          variants={staggerContainer(0.04, 0.06)}
          initial="hidden"
          animate="show"
        >
          {rows.map(({ article, index, isHero }, rowIdx) => {
            const rowNumber = rowIdx + 1;
            const isFocused =
              currentSection === "Top" &&
              topArticles[focusedIndex]?.id === article.id;

            return (
              <motion.button
                key={article.id}
                variants={rowVariants}
                transition={TRANSITIONS.base}
                onClick={() =>
                  isHero ? onHeroReadMore() : onFeaturedClick(article)
                }
                className={`w-full grid items-center px-4 md:px-5 py-3 md:py-4 text-left transition-colors
                  border-b border-[var(--featured-card-border)]
                  hover:bg-[var(--color-bg-primary)]
                  ${rowIdx % 2 === 1 ? "bg-[var(--color-text-primary)]/[0.02]" : ""}
                  ${isFocused ? "border-l-[3px] border-l-[var(--color-accent)]" : "border-l-[3px] border-l-transparent"}
                `}
                style={{ gridTemplateColumns: "48px 1fr 120px 48px" }}
              >
                {/* Row number */}
                <span
                  className={`font-mono tabular-nums ${
                    isHero
                      ? "text-base font-bold text-[var(--color-accent)]"
                      : "text-sm text-[var(--color-text-secondary)]"
                  }`}
                >
                  {rowNumber}
                </span>

                {/* Headline */}
                <span
                  className={`font-header leading-snug line-clamp-1 pr-3 ${
                    isHero
                      ? "text-base md:text-lg text-[var(--color-text-primary)] font-semibold"
                      : "text-sm md:text-base text-[var(--color-text-primary)]"
                  }`}
                >
                  {article.headline}
                </span>

                {/* Byline */}
                <span className="hidden sm:block font-body text-xs text-[var(--color-text-secondary)] opacity-60 truncate text-right pr-2">
                  {article.byline || "\u2014"}
                </span>

                {/* Page number */}
                <span className="font-mono text-xs tabular-nums text-[var(--color-text-secondary)] opacity-50 text-right">
                  {article.page}
                </span>
              </motion.button>
            );
          })}
        </motion.div>
      </motion.div>

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
