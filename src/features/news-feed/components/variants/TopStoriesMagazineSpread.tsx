"use client";

import React from "react";
import { motion } from "framer-motion";
import Image from "next/image";
import { fadeUp, staggerContainer, TRANSITIONS } from "@/shared/motion/motionTokens";
import { ExpandedArticleSlot } from "./ExpandedArticleSlot";
import type { TopStoriesVariantProps } from "./TopStoriesVariantProps";

const sectionVariants = fadeUp(18);
const cardVariants = fadeUp(12);
const sectionContainer = staggerContainer(0.08, 0.12);

export const TopStoriesMagazineSpread: React.FC<TopStoriesVariantProps> = ({
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
      key="magazine-spread"
      className="flex flex-col gap-6"
      variants={sectionContainer}
      initial="hidden"
      animate="show"
    >
      {/* ── Hero: full-width background image with overlaid text ── */}
      {heroArticle && (
        <motion.section
          variants={sectionVariants}
          transition={TRANSITIONS.base}
          className={`relative w-full aspect-[16/9] min-h-[280px] overflow-hidden cursor-pointer group ${
            focusedIndex === 0 && currentSection === "Top"
              ? "ring-2 ring-[var(--color-accent)] ring-offset-2 ring-offset-[var(--color-bg-primary)]"
              : ""
          }`}
          onClick={onHeroReadMore}
        >
          {/* Background image or fallback */}
          {hasHeroImage ? (
            <Image
              src={heroArticle.imageUrls[0]}
              alt={heroArticle.headline}
              fill
              className="object-cover transition-transform duration-700 group-hover:scale-[1.03]"
              priority
            />
          ) : (
            <div className="absolute inset-0 bg-[var(--color-accent)] opacity-20" />
          )}

          {/* Gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />

          {/* Text overlay */}
          <div className="absolute inset-x-0 bottom-0 p-5 md:p-8 flex flex-col gap-2">
            <span className="inline-block self-start px-2 py-0.5 bg-[var(--color-accent)] text-white font-mono text-[10px] uppercase tracking-[0.15em] font-bold">
              {heroArticle.category}
            </span>

            <h1 className="font-header text-2xl md:text-4xl lg:text-5xl text-white leading-tight drop-shadow-lg">
              {heroArticle.headline}
            </h1>

            {heroArticle.byline && (
              <p className="font-mono text-xs uppercase tracking-[0.12em] text-white/70">
                By {heroArticle.byline}
              </p>
            )}
          </div>
        </motion.section>
      )}

      {/* ── Featured: captioned thumbnail row ── */}
      {featuredArticles.length > 0 && (
        <motion.section
          variants={sectionVariants}
          transition={TRANSITIONS.base}
          className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4"
        >
          {featuredArticles.slice(0, 3).map((article, index) => {
            const hasImage = article.imageUrls.length > 0;
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
                className={`text-left bg-[var(--featured-card-bg)] border border-[var(--featured-card-border)] overflow-hidden group cursor-pointer transition-colors hover:border-[var(--color-accent)] ${
                  isFocused
                    ? "ring-2 ring-[var(--color-accent)] ring-offset-2 ring-offset-[var(--color-bg-primary)]"
                    : ""
                }`}
              >
                {hasImage && (
                  <div className="relative w-full aspect-[4/3] overflow-hidden">
                    <Image
                      src={article.imageUrls[0]}
                      alt={article.headline}
                      fill
                      className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                    />
                  </div>
                )}
                <div className="p-3 space-y-1">
                  <h3 className="font-header text-sm md:text-base leading-snug text-[var(--color-text-primary)] line-clamp-2">
                    {article.headline}
                  </h3>
                  {article.byline && (
                    <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--color-text-secondary)] opacity-60">
                      {article.byline.split(",")[0]}
                    </p>
                  )}
                </div>
              </motion.button>
            );
          })}
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
