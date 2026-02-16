"use client";

import React from "react";
import { motion } from "framer-motion";
import Image from "next/image";
import { fadeUp, staggerContainer, TRANSITIONS } from "@/shared/motion/motionTokens";
import { ExpandedArticleSlot } from "./ExpandedArticleSlot";
import type { TopStoriesVariantProps } from "./TopStoriesVariantProps";

const tileVariants = fadeUp(16);
const mosaicContainer = staggerContainer(0.06, 0.1);

export const TopStoriesMosaic: React.FC<TopStoriesVariantProps> = ({
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
  // Build 4-tile array from hero + first 3 featured
  const tiles = [
    ...(heroArticle ? [{ article: heroArticle, isHero: true }] : []),
    ...featuredArticles.slice(0, 3).map((a) => ({ article: a, isHero: false })),
  ];

  return (
    <motion.div
      key="mosaic-section"
      className="flex flex-col gap-6"
      variants={mosaicContainer}
      initial="hidden"
      animate="show"
    >
      {/* ── 2x2 Mosaic Grid ── */}
      <div className="grid grid-cols-2 gap-3">
        {tiles.map(({ article, isHero }, index) => {
          const hasImage = article.imageUrls.length > 0;
          const isFocused =
            currentSection === "Top" &&
            topArticles[focusedIndex]?.id === article.id;

          return (
            <motion.button
              key={article.id}
              variants={tileVariants}
              transition={TRANSITIONS.base}
              onClick={() =>
                isHero ? onHeroReadMore() : onFeaturedClick(article)
              }
              className={`relative aspect-square overflow-hidden cursor-pointer group text-left ${
                isFocused
                  ? "ring-2 ring-[var(--color-accent)] ring-offset-2 ring-offset-[var(--color-bg-primary)]"
                  : ""
              }`}
            >
              {/* Background image or solid */}
              {hasImage ? (
                <Image
                  src={article.imageUrls[0]}
                  alt={article.headline}
                  fill
                  className="object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                />
              ) : (
                <div className="absolute inset-0 bg-[var(--featured-card-bg)]" />
              )}

              {/* Dark gradient overlay — more opaque on hover */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent opacity-80 group-hover:opacity-95 transition-opacity duration-300" />

              {/* Category badge */}
              <span className="absolute top-2 left-2 px-1.5 py-0.5 bg-[var(--color-accent)] text-white font-mono text-[9px] uppercase tracking-[0.12em] font-bold">
                {article.category}
              </span>

              {/* Headline overlay */}
              <div className="absolute inset-x-0 bottom-0 p-3 md:p-4">
                <h3 className="font-header text-sm md:text-base lg:text-lg text-white leading-snug line-clamp-3 drop-shadow-md">
                  {article.headline}
                </h3>
              </div>
            </motion.button>
          );
        })}
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
