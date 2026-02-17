"use client";
import React, { useState, useCallback } from "react";
import { motion } from "framer-motion";
import { fadeUp, staggerContainer, TRANSITIONS } from "@/shared/motion/motionTokens";
import type { TopStoriesVariantProps } from "./TopStoriesVariantProps";
import {
  extractParagraphs,
  LONG_ARTICLE_THRESHOLD,
  DoubleRule,
  OrnamentRow,
  Kicker,
  Byline,
  ArticleImage,
  ColumnText,
  Lightbox,
} from "./print-edition-primitives";

const sectionVariants = fadeUp(18);
const sectionContainer = staggerContainer(0.08, 0.12);

// ─── Main Component ────────────────────────────────────────────────

export const TopStoriesPrintEdition: React.FC<TopStoriesVariantProps> = ({
  heroArticle,
  featuredArticles,
  expandedId: _expandedId,
  focusedIndex: _focusedIndex,
  topArticles: _topArticles,
  onHeroReadMore: _onHeroReadMore,
  onFeaturedClick: _onFeaturedClick,
  onExpandedToggle: _onExpandedToggle,
  onViewOriginal: _onViewOriginal,
  topExpandedArticle: _topExpandedArticle,
  currentSection: _currentSection,
  topExpandedRef: _topExpandedRef,
}) => {
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const closeLightbox = useCallback(() => setLightboxSrc(null), []);

  return (
    <motion.div
      key="print-edition"
      className="flex flex-col"
      variants={sectionContainer}
      initial="hidden"
      animate="show"
    >
      {/* ── Top double rule ───────────────────────────────────── */}
      <DoubleRule />

      {/* ── Hero Article ──────────────────────────────────────── */}
      {heroArticle && (
        <motion.article
          className="mb-2"
          variants={sectionVariants}
          transition={TRANSITIONS.base}
        >
          {/* Kicker */}
          <Kicker category={heroArticle.category} />

          {/* Headline */}
            <h1
              className="text-[var(--color-text-primary)] mb-6"
              style={{
                fontFamily: "var(--font-header)",
                fontSize: "clamp(18px, 3vw, 26px)",
              fontWeight: 700,
              lineHeight: 1.2,
              letterSpacing: "-0.01em",
            }}
          >
            {heroArticle.headline}
          </h1>

          {/* Byline left-aligned */}
          <Byline byline={heroArticle.byline} />

          {/* Image + body text in columns */}
          {heroArticle.fullText ? (
            <ColumnText
              paragraphs={extractParagraphs(heroArticle.fullText)}
              columns={3}
              fontSize="15px"
              image={
                heroArticle.imageUrls.length > 0 ? (
                  <ArticleImage
                    src={heroArticle.imageUrls[0]}
                    alt={heroArticle.headline}
                    caption={heroArticle.imageCaption}
                    onClick={() => setLightboxSrc(heroArticle.imageUrls[0])}
                    priority
                    width="full"
                  />
                ) : undefined
              }
            />
          ) : (
            <p
              className="text-[var(--color-text-primary)]"
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "15px",
                lineHeight: 1.7,
                textAlign: "justify",
                hyphens: "auto",
              }}
            >
              {heroArticle.summary}
            </p>
          )}

        </motion.article>
      )}

      {/* ── Featured Articles ─────────────────────────────────── */}
      {featuredArticles.length > 0 && (
        <motion.div variants={sectionVariants} transition={TRANSITIONS.base}>
          {featuredArticles.map((article, index) => {
            const paragraphs = article.fullText
              ? extractParagraphs(article.fullText)
              : [];
            const plainText = paragraphs.join(" ");
            const isLong = plainText.length > LONG_ARTICLE_THRESHOLD;
            const hasImage = article.imageUrls.length > 0;

            return (
              <React.Fragment key={article.id}>
                <motion.article
                  className="py-5"
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    ...TRANSITIONS.base,
                    delay: 0.15 + index * 0.08,
                  }}
                >
                  {/* Single rule top */}
                  <div
                    aria-hidden="true"
                    className="mb-4"
                    style={{ borderTop: "2px solid var(--color-accent)" }}
                  />

                  {isLong ? (
                    /* ── Long Featured Layout ─────────────── */
                    <>
                      <Kicker category={article.category} />
                      <h2
                        className="text-[var(--color-text-primary)] mb-4"
                        style={{
                          fontFamily: "var(--font-header)",
                          fontSize: "clamp(22px, 3.5vw, 30px)",
                          fontWeight: 700,
                          lineHeight: 1.15,
                        }}
                      >
                        {article.headline}
                      </h2>
                      <Byline byline={article.byline} />

                      {/* All text in 3 columns, image in column flow */}
                      <ColumnText
                        paragraphs={paragraphs}
                        columns={3}
                        image={
                          hasImage ? (
                            <ArticleImage
                              src={article.imageUrls[0]}
                              alt={article.headline}
                              caption={article.imageCaption}
                              onClick={() =>
                                setLightboxSrc(article.imageUrls[0])
                              }
                              width="full"
                            />
                          ) : undefined
                        }
                      />
                    </>
                  ) : (
                    /* ── Short Featured Layout ────────────── */
                    <>
                      <Kicker category={article.category} />
                      <h2
                        className="text-[var(--color-text-primary)] mb-4"
                        style={{
                          fontFamily: "var(--font-header)",
                          fontSize: "clamp(18px, 3vw, 26px)",
                          fontWeight: 700,
                          lineHeight: 1.2,
                        }}
                      >
                        {article.headline}
                      </h2>
                      <Byline byline={article.byline} />

                      {/* All text in 2 columns, image in column flow */}
                      <ColumnText
                        paragraphs={paragraphs}
                        columns={2}
                        image={
                          hasImage ? (
                            <ArticleImage
                              src={article.imageUrls[0]}
                              alt={article.headline}
                              caption={article.imageCaption}
                              onClick={() =>
                                setLightboxSrc(article.imageUrls[0])
                              }
                              width="full"
                            />
                          ) : undefined
                        }
                      />
                    </>
                  )}
                </motion.article>

              </React.Fragment>
            );
          })}
        </motion.div>
      )}

      {/* ── Bottom Ornament ───────────────────────────────────── */}
      <div className="mt-6 pt-4">
        <OrnamentRow variant="bottom" />
      </div>

      {/* ── Lightbox Overlay ──────────────────────────────────── */}
      <Lightbox src={lightboxSrc} onClose={closeLightbox} />
    </motion.div>
  );
};
