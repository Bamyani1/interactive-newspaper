"use client";

import React from "react";
import { motion } from "framer-motion";
import { fadeUp, staggerContainer, TRANSITIONS } from "@/shared/motion/motionTokens";
import { ExpandedArticleSlot } from "./ExpandedArticleSlot";
import type { TopStoriesVariantProps } from "./TopStoriesVariantProps";

const sectionVariants = fadeUp(14);
const itemVariants = fadeUp(10);
const container = staggerContainer(0.06, 0.1);

export const TopStoriesTelegraph: React.FC<TopStoriesVariantProps> = ({
  heroArticle,
  featuredArticles,
  topExpandedArticle,
  onHeroReadMore,
  onFeaturedClick,
  onExpandedToggle,
  onViewOriginal,
  topExpandedRef,
}) => (
  <motion.div
    key="telegraph-section"
    className="flex flex-col gap-0 font-mono"
    variants={container}
    initial="hidden"
    animate="show"
    style={{ color: "var(--color-text-primary)" }}
  >
    {/* Wire header */}
    <motion.div
      variants={sectionVariants}
      transition={TRANSITIONS.base}
      className="text-center py-4"
      style={{ borderBottom: "2px dashed var(--color-text-secondary)" }}
    >
      <div
        className="text-xs tracking-[0.3em] uppercase"
        style={{ color: "var(--color-text-secondary)" }}
      >
        ======================================
      </div>
      <div
        className="text-sm font-bold tracking-[0.25em] uppercase mt-1"
        style={{ color: "var(--color-accent)" }}
      >
        === WIRE SERVICE DISPATCH ===
      </div>
      <div
        className="text-xs tracking-[0.3em] uppercase"
        style={{ color: "var(--color-text-secondary)" }}
      >
        ======================================
      </div>
    </motion.div>

    {/* Hero dispatch */}
    {heroArticle && (
      <motion.div
        variants={sectionVariants}
        transition={TRANSITIONS.base}
        className="py-6 px-4"
        style={{
          borderBottom: "1px dashed var(--featured-card-border)",
          backgroundColor: "var(--color-bg-primary)",
        }}
      >
        <div
          className="text-xs uppercase tracking-widest mb-3"
          style={{ color: "var(--color-accent)" }}
        >
          DATELINE: {heroArticle.category.toUpperCase()} &mdash;{" "}
          {heroArticle.date}
        </div>

        <h2
          className="text-2xl md:text-3xl font-bold uppercase leading-tight mb-3 tracking-wide"
          style={{ color: "var(--color-text-primary)" }}
        >
          {heroArticle.headline.toUpperCase()}
        </h2>

        {heroArticle.byline && (
          <div
            className="text-xs uppercase tracking-widest mb-4"
            style={{ color: "var(--color-text-secondary)" }}
          >
            FILED BY: {heroArticle.byline}
          </div>
        )}

        <p
          className="text-sm leading-relaxed mb-4 max-w-prose"
          style={{ color: "var(--color-text-secondary)" }}
        >
          {heroArticle.summary}
        </p>

        <button
          onClick={onHeroReadMore}
          className="text-xs uppercase tracking-[0.2em] cursor-pointer bg-transparent border-none font-mono"
          style={{ color: "var(--color-accent)" }}
        >
          --- MORE ---
        </button>
      </motion.div>
    )}

    {/* Featured dispatches */}
    {featuredArticles.length > 0 && (
      <motion.div
        variants={sectionVariants}
        transition={TRANSITIONS.base}
        className="py-4"
        style={{ backgroundColor: "var(--featured-card-bg)" }}
      >
        <div
          className="text-xs uppercase tracking-[0.2em] px-4 pb-2 mb-2"
          style={{
            color: "var(--color-text-secondary)",
            borderBottom: "1px dashed var(--featured-card-border)",
          }}
        >
          +++ ADDITIONAL DISPATCHES +++
        </div>

        <div className="flex flex-col">
          {featuredArticles.map((article, index) => (
            <motion.button
              key={article.id}
              variants={itemVariants}
              transition={TRANSITIONS.base}
              onClick={() => onFeaturedClick(article)}
              className="text-left px-4 py-3 cursor-pointer bg-transparent border-none font-mono w-full"
              style={{
                color: "var(--color-text-primary)",
                borderBottom:
                  index < featuredArticles.length - 1
                    ? "1px dashed var(--featured-card-border)"
                    : "none",
              }}
              whileHover={{ x: 4 }}
            >
              <span
                className="text-xs"
                style={{ color: "var(--color-text-secondary)" }}
              >
                ++{" "}
              </span>
              <span
                className="text-xs uppercase font-bold"
                style={{ color: "var(--color-accent)" }}
              >
                {article.category.toUpperCase()}
              </span>
              <span
                className="text-xs"
                style={{ color: "var(--color-text-secondary)" }}
              >
                {" "}
                &mdash;{" "}
              </span>
              <span className="text-sm uppercase">
                {article.headline.toUpperCase()}
              </span>
              <span
                className="text-xs"
                style={{ color: "var(--color-text-secondary)" }}
              >
                {" "}
                &mdash; By {article.byline ?? "Staff"}, Pg. {article.page}
              </span>
            </motion.button>
          ))}
        </div>
      </motion.div>
    )}

    {/* Expanded article slot */}
    <ExpandedArticleSlot
      article={topExpandedArticle}
      expandedRef={topExpandedRef}
      onToggle={onExpandedToggle}
      onViewOriginal={onViewOriginal}
    />
  </motion.div>
);
