"use client";
import React from "react";
import { motion } from "framer-motion";
import Image from "next/image";
import { fadeUp, staggerContainer, TRANSITIONS } from "@/shared/motion/motionTokens";
import { ExpandedArticleSlot } from "./ExpandedArticleSlot";
import type { TopStoriesVariantProps } from "./TopStoriesVariantProps";

const sectionVariants = fadeUp(18);
const sectionContainer = staggerContainer(0.08, 0.12);

export const TopStoriesFrontPage: React.FC<TopStoriesVariantProps> = ({
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
  const hasHeroImage = heroArticle && heroArticle.imageUrls.length > 0;

  return (
    <motion.div
      key="front-page"
      className="flex flex-col gap-8"
      variants={sectionContainer}
      initial="hidden"
      animate="show"
    >
      {/* ── 3-Column Newspaper Grid ─────────────────────────────── */}
      <motion.div variants={sectionVariants} transition={TRANSITIONS.base}>
        <div
          className="grid grid-cols-1 md:grid-cols-3 gap-0"
          style={{
            borderTop: "3px double var(--color-border-default)",
            borderBottom: "1px solid var(--color-border-default)",
          }}
        >
          {/* ── Hero Cell (spans 2 columns on desktop) ──────────── */}
          {heroArticle && (
            <motion.article
              className="md:col-span-2 p-4 md:p-5 cursor-pointer group"
              style={{
                borderRight: "1px solid var(--color-border-default)",
                background: "var(--featured-card-bg)",
              }}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...TRANSITIONS.base, delay: 0.1 }}
              onClick={onHeroReadMore}
            >
              {/* Category & Date Meta */}
              <div className="flex items-center gap-2 mb-2 font-mono text-[10px] uppercase tracking-[0.15em]">
                <span className="text-[var(--color-accent)] font-bold">
                  {heroArticle.category}
                </span>
                <span className="text-[var(--color-text-secondary)]" aria-hidden="true">
                  &middot;
                </span>
                <span className="text-[var(--color-text-secondary)]">
                  {heroArticle.date}
                </span>
                {heroArticle.page && (
                  <>
                    <span className="text-[var(--color-text-secondary)]" aria-hidden="true">
                      &middot;
                    </span>
                    <span className="text-[var(--color-text-secondary)]">
                      Pg.&nbsp;{heroArticle.page}
                    </span>
                  </>
                )}
              </div>

              {/* Headline */}
              <h1 className="font-header text-2xl md:text-3xl lg:text-4xl text-[var(--color-text-primary)] leading-tight mb-3 group-hover:text-[var(--color-accent)] transition-colors">
                {heroArticle.headline}
              </h1>

              {/* Byline */}
              {heroArticle.byline && (
                <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--color-text-secondary)] opacity-60 mb-3">
                  By {heroArticle.byline}
                </p>
              )}

              {/* Image + Summary Row */}
              <div className="flex flex-col sm:flex-row gap-4 items-start">
                {hasHeroImage && (
                  <div className="shrink-0 relative w-full sm:w-[240px] md:w-[280px] aspect-[4/3] border border-[var(--color-border-default)] overflow-hidden">
                    <Image
                      src={heroArticle.imageUrls[0]}
                      alt={heroArticle.headline}
                      fill
                      className="object-cover"
                      priority
                    />
                  </div>
                )}
                <div className="flex-1">
                  <p
                    className="font-body text-base md:text-lg leading-relaxed text-[var(--color-text-secondary)] mb-3"
                    style={{ textAlign: "justify", hyphens: "auto" }}
                  >
                    {heroArticle.summary}
                  </p>
                  {heroArticle.imageCaption && hasHeroImage && (
                    <p className="font-body text-xs italic text-[var(--color-text-secondary)] opacity-50 mt-1">
                      {heroArticle.imageCaption}
                    </p>
                  )}
                </div>
              </div>
            </motion.article>
          )}

          {/* ── Featured Articles (fill remaining cells) ─────────── */}
          {featuredArticles.map((article, index) => {
            const hasImage = article.imageUrls.length > 0;
            const isFocused =
              currentSection === "Top" &&
              focusedIndex > 0 &&
              topArticles[focusedIndex]?.id === article.id;

            // On the 3-col grid: first featured goes in col 3 row 1,
            // subsequent ones fill new rows across all 3 columns.
            return (
              <motion.article
                key={article.id}
                className={`p-4 md:p-5 cursor-pointer group ${
                  isFocused
                    ? "ring-2 ring-[var(--color-accent)] ring-offset-2 ring-offset-[var(--color-bg-primary)]"
                    : ""
                }`}
                style={{
                  background: "var(--featured-card-bg)",
                  borderRight:
                    (index + 1) % 3 !== 0
                      ? "1px solid var(--color-border-default)"
                      : undefined,
                  borderTop: "1px solid var(--color-border-default)",
                }}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  ...TRANSITIONS.base,
                  delay: 0.15 + index * 0.08,
                }}
                onClick={() => onFeaturedClick(article)}
              >
                {/* Image */}
                {hasImage && (
                  <div className="relative w-full aspect-[3/2] mb-3 border border-[var(--color-border-default)] overflow-hidden">
                    <Image
                      src={article.imageUrls[0]}
                      alt={article.headline}
                      fill
                      className="object-cover transition-transform duration-500 group-hover:scale-[1.02]"
                    />
                  </div>
                )}

                {/* Category Badge */}
                <div className="font-mono text-[9px] uppercase tracking-[0.15em] text-[var(--color-accent)] font-bold mb-1.5">
                  {article.category}
                </div>

                {/* Headline */}
                <h3 className="font-header text-base md:text-lg font-bold leading-tight text-[var(--color-text-primary)] mb-1.5 group-hover:text-[var(--color-accent)] transition-colors line-clamp-3">
                  {article.headline}
                </h3>

                {/* Byline */}
                {article.byline && (
                  <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--color-text-secondary)] opacity-60 mb-2">
                    By {article.byline.split(",")[0]}
                  </p>
                )}

                {/* Summary */}
                <p
                  className="font-body text-sm leading-relaxed text-[var(--color-text-secondary)] line-clamp-4"
                  style={{ textAlign: "justify", hyphens: "auto" }}
                >
                  {article.summary}
                </p>

                {/* Footer */}
                <div className="mt-3 pt-2 border-t border-[var(--featured-card-border)] flex justify-between items-center font-mono text-[10px] text-[var(--color-text-secondary)] uppercase tracking-wide">
                  <span>{article.byline?.split(",")[0] || "Staff"}</span>
                  <span>Pg.&nbsp;{article.page || 1}</span>
                </div>
              </motion.article>
            );
          })}
        </div>
      </motion.div>

      {/* ── Expanded Article Slot ───────────────────────────────── */}
      <ExpandedArticleSlot
        article={topExpandedArticle}
        expandedRef={topExpandedRef}
        onToggle={onExpandedToggle}
        onViewOriginal={onViewOriginal}
      />
    </motion.div>
  );
};
