"use client";
import React, { useState, useCallback } from "react";
import { motion } from "framer-motion";
import { fadeUp, staggerContainer, TRANSITIONS } from "@/shared/motion/motionTokens";
import type { Article } from "@/src/types";
import {
  extractParagraphs,
  LONG_ARTICLE_THRESHOLD,
  DoubleRule,
  OrnamentRow,
  Kicker,
  Byline,
  ArticleImage,
  ColumnText,
  PhotoFeature,
  ImageGallery,
  Lightbox,
} from "./print-edition-primitives";

const sectionVariants = fadeUp(18);
const sectionContainer = staggerContainer(0.08, 0.12);

interface SectionPrintEditionProps {
  articles: Article[];
  onViewOriginal: (article: Article) => void;
}

export const SectionPrintEdition: React.FC<SectionPrintEditionProps> = ({
  articles,
  onViewOriginal: _onViewOriginal,
}) => {
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const closeLightbox = useCallback(() => setLightboxSrc(null), []);

  if (articles.length === 0) return null;

  const [heroArticle, ...remainingArticles] = articles;

  return (
    <motion.div
      key="section-print-edition"
      className="flex flex-col"
      variants={sectionContainer}
      initial="hidden"
      animate="show"
    >
      {/* ── Top double rule ───────────────────────────────────── */}
      <DoubleRule />

      {/* ── Hero Article (first in section) ────────────────────── */}
      <motion.article
        className="mb-2"
        variants={sectionVariants}
        transition={TRANSITIONS.base}
      >
        <Kicker category={heroArticle.category} />

        {!heroArticle.fullText && heroArticle.imageUrls.length > 0 ? (
          /* ── Photo-only hero ───────────────────────── */
          <>
            <PhotoFeature
              headline={heroArticle.headline}
              imageSrc={heroArticle.imageUrls[0]}
              alt={heroArticle.headline}
              caption={heroArticle.imageCaptions?.[0] ?? heroArticle.imageCaption}
              byline={heroArticle.byline}
              onImageClick={() => setLightboxSrc(heroArticle.imageUrls[0])}
            />
            {heroArticle.imageUrls.length > 1 && (
              <ImageGallery
                images={heroArticle.imageUrls.slice(1, 2).map((url, i) => ({
                  src: url,
                  caption: heroArticle.imageCaptions?.[i + 1],
                }))}
                alt={heroArticle.headline}
                onClick={(src) => setLightboxSrc(src)}
              />
            )}
          </>
        ) : heroArticle.fullText ? (
          <ColumnText
            paragraphs={extractParagraphs(heroArticle.fullText)}
            columns={3}
            fontSize="15px"
            header={
              <>
                <h1
                  className="text-[var(--color-text-primary)] mb-4"
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
                <Byline byline={heroArticle.byline} />
              </>
            }
            image={
              heroArticle.imageUrls.length > 0
                ? heroArticle.imageUrls.slice(0, 2).map((url, i) => (
                    <ArticleImage
                      key={url}
                      src={url}
                      alt={heroArticle.headline}
                      caption={heroArticle.imageCaptions?.[i] ?? (i === 0 ? heroArticle.imageCaption : null)}
                      onClick={() => setLightboxSrc(url)}
                      priority={i === 0}
                      width="full"
                      maxWidth={heroArticle.imageUrls.length > 1 ? "90%" : "100%"}
                    />
                  ))
                : undefined
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

      {/* ── Remaining Articles ─────────────────────────────────── */}
      {remainingArticles.length > 0 && (
        <motion.div variants={sectionVariants} transition={TRANSITIONS.base}>
          {remainingArticles.map((article, index) => {
            const paragraphs = article.fullText
              ? extractParagraphs(article.fullText)
              : [];
            const plainText = paragraphs.join(" ");
            const isLong = plainText.length > LONG_ARTICLE_THRESHOLD;
            const hasImage = article.imageUrls.length > 0;
            const isPhotoOnly = paragraphs.length === 0 && hasImage;
            const cols = hasImage || isLong ? 3 : 2;

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
                  {/* Single accent rule */}
                  <div
                    aria-hidden="true"
                    className="mb-4"
                    style={{ borderTop: "2px solid var(--color-accent)" }}
                  />

                  <Kicker category={article.category} />

                  {isPhotoOnly ? (
                    <>
                      <PhotoFeature
                        headline={article.headline}
                        imageSrc={article.imageUrls[0]}
                        alt={article.headline}
                        caption={article.imageCaptions?.[0] ?? article.imageCaption}
                        byline={article.byline}
                        onImageClick={() =>
                          setLightboxSrc(article.imageUrls[0])
                        }
                      />
                      {article.imageUrls.length > 1 && (
                        <ImageGallery
                          images={article.imageUrls.slice(1, 2).map((url, i) => ({
                            src: url,
                            caption: article.imageCaptions?.[i + 1],
                          }))}
                          alt={article.headline}
                          onClick={(src) => setLightboxSrc(src)}
                        />
                      )}
                    </>
                  ) : (
                    <ColumnText
                      paragraphs={paragraphs}
                      columns={cols}
                      header={
                        <>
                          <h2
                            className="text-[var(--color-text-primary)] mb-4"
                            style={{
                              fontFamily: "var(--font-header)",
                              fontSize: isLong
                                ? "clamp(22px, 3.5vw, 30px)"
                                : "clamp(18px, 3vw, 26px)",
                              fontWeight: 700,
                              lineHeight: isLong ? 1.15 : 1.2,
                            }}
                          >
                            {article.headline}
                          </h2>
                          <Byline byline={article.byline} />
                        </>
                      }
                      image={
                        hasImage
                          ? article.imageUrls.slice(0, 2).map((url, i) => (
                              <ArticleImage
                                key={url}
                                src={url}
                                alt={article.headline}
                                caption={article.imageCaptions?.[i] ?? (i === 0 ? article.imageCaption : null)}
                                onClick={() => setLightboxSrc(url)}
                                width="full"
                                maxWidth={article.imageUrls.length > 1 ? "90%" : "100%"}
                              />
                            ))
                          : undefined
                      }
                    />
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
