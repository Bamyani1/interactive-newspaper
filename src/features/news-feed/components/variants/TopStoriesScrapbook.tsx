"use client";

import React from "react";
import { motion } from "framer-motion";
import Image from "next/image";
import { fadeUp, staggerContainer, TRANSITIONS } from "@/shared/motion/motionTokens";
import { ExpandedArticleSlot } from "./ExpandedArticleSlot";
import type { TopStoriesVariantProps } from "./TopStoriesVariantProps";

const cardVariants = fadeUp(20);
const scrapContainer = staggerContainer(0.1, 0.15);

// Predefined "random" rotations + offsets for a collage feel
const CARD_TRANSFORMS = [
  { rotate: -2, x: 0, y: 0 },
  { rotate: 1.5, x: 8, y: -4 },
  { rotate: -1, x: -6, y: 6 },
  { rotate: 2.5, x: 4, y: -2 },
];

export const TopStoriesScrapbook: React.FC<TopStoriesVariantProps> = ({
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
      key="scrapbook-section"
      className="flex flex-col gap-8"
      variants={scrapContainer}
      initial="hidden"
      animate="show"
    >
      {/* ── Hero: overlapping "pinned" card ── */}
      {heroArticle && (
        <motion.section
          variants={cardVariants}
          transition={TRANSITIONS.base}
          className={`relative mx-auto w-[95%] max-w-2xl cursor-pointer group ${
            focusedIndex === 0 && currentSection === "Top"
              ? "ring-2 ring-[var(--color-accent)] ring-offset-4 ring-offset-[var(--color-bg-primary)]"
              : ""
          }`}
          style={{
            transform: "rotate(-1.5deg)",
          }}
          whileHover={{ rotate: 0, scale: 1.01 }}
          onClick={onHeroReadMore}
        >
          {/* Card body */}
          <div
            className="relative overflow-hidden border-2 border-[var(--featured-card-border)]"
            style={{
              background: "var(--featured-card-bg)",
              boxShadow: "4px 6px 16px rgba(0,0,0,0.15)",
            }}
          >
            {/* Tape decoration top-left */}
            <div
              className="absolute -top-1 left-6 w-12 h-5 z-10 opacity-60"
              style={{
                background: "var(--color-accent)",
                transform: "rotate(-6deg)",
              }}
            />

            {hasHeroImage && (
              <div className="relative w-full aspect-[3/2] border-b-2 border-[var(--featured-card-border)]">
                <Image
                  src={heroArticle.imageUrls[0]}
                  alt={heroArticle.headline}
                  fill
                  className="object-cover"
                  priority
                />
              </div>
            )}

            <div className="p-4 md:p-5 space-y-2">
              <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--color-accent)] font-bold">
                {heroArticle.category}
              </div>
              <h1 className="font-header text-xl md:text-2xl lg:text-3xl text-[var(--color-text-primary)] leading-snug">
                {heroArticle.headline}
              </h1>
              {heroArticle.byline && (
                <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--color-text-secondary)] opacity-60">
                  By {heroArticle.byline}
                </p>
              )}
              <p className="font-body text-sm md:text-base leading-relaxed text-[var(--color-text-secondary)] line-clamp-3">
                {heroArticle.summary}
              </p>
            </div>
          </div>
        </motion.section>
      )}

      {/* ── Featured: scattered cards ── */}
      {featuredArticles.length > 0 && (
        <div className="relative grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 px-2">
          {featuredArticles.slice(0, 3).map((article, index) => {
            const hasImage = article.imageUrls.length > 0;
            const transform = CARD_TRANSFORMS[index % CARD_TRANSFORMS.length];
            const isFocused =
              currentSection === "Top" &&
              focusedIndex > 0 &&
              topArticles[focusedIndex]?.id === article.id;

            return (
              <motion.button
                key={article.id}
                variants={cardVariants}
                transition={TRANSITIONS.base}
                onClick={() => onFeaturedClick(article)}
                className={`relative text-left cursor-pointer group ${
                  isFocused
                    ? "ring-2 ring-[var(--color-accent)] ring-offset-2 ring-offset-[var(--color-bg-primary)]"
                    : ""
                }`}
                style={{
                  transform: `rotate(${transform.rotate}deg) translate(${transform.x}px, ${transform.y}px)`,
                }}
                whileHover={{ rotate: 0, scale: 1.03, x: 0, y: 0 }}
              >
                {/* Pin decoration */}
                <div
                  className="absolute -top-2 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full z-10"
                  style={{
                    background: "var(--color-accent)",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                  }}
                />

                <div
                  className="overflow-hidden border border-[var(--featured-card-border)]"
                  style={{
                    background: "var(--featured-card-bg)",
                    boxShadow: "3px 4px 12px rgba(0,0,0,0.12)",
                  }}
                >
                  {hasImage && (
                    <div className="relative w-full aspect-[4/3]">
                      <Image
                        src={article.imageUrls[0]}
                        alt={article.headline}
                        fill
                        className="object-cover"
                      />
                    </div>
                  )}
                  <div className="p-3 space-y-1">
                    <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--color-accent)] font-bold">
                      {article.category}
                    </span>
                    <h3 className="font-header text-sm leading-snug text-[var(--color-text-primary)] line-clamp-2">
                      {article.headline}
                    </h3>
                    {article.byline && (
                      <p className="font-body text-[10px] text-[var(--color-text-secondary)] opacity-60">
                        {article.byline.split(",")[0]}
                      </p>
                    )}
                  </div>
                </div>
              </motion.button>
            );
          })}
        </div>
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
