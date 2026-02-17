"use client";
import React, { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";
import { fadeUp, staggerContainer, TRANSITIONS } from "@/shared/motion/motionTokens";
import type { TopStoriesVariantProps } from "./TopStoriesVariantProps";

const sectionVariants = fadeUp(18);
const sectionContainer = staggerContainer(0.08, 0.12);

// ─── Helpers ───────────────────────────────────────────────────────

/** Extract clean text paragraphs from HTML-formatted fullText. */
function extractParagraphs(html: string): string[] {
  return html
    .split(/<\/?p[^>]*>/i)
    .map((s) => s.replace(/<[^>]+>/g, "").trim())
    .filter(Boolean);
}

/** Longer articles get 3 columns, shorter ones get 2. */
const LONG_ARTICLE_THRESHOLD = 2000;

// ─── Sub-components ────────────────────────────────────────────────

/** Drop cap for the first paragraph of the hero article. */
function DropCap({ text }: { text: string }) {
  if (!text) return null;
  const first = text.charAt(0);
  const rest = text.slice(1);
  return (
    <p
      className="mb-3 text-[var(--color-text-primary)]"
      style={{
        fontFamily: "var(--font-body)",
        fontSize: "15px",
        lineHeight: 1.7,
        textAlign: "justify",
        hyphens: "auto",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          fontFamily: "var(--font-header)",
          float: "left",
          fontSize: "3.5em",
          fontWeight: 700,
          lineHeight: 0.8,
          marginRight: "0.08em",
          marginTop: "0.05em",
          color: "var(--color-accent)",
        }}
      >
        {first}
      </span>
      {rest}
    </p>
  );
}

/** Thick-thin double rule section divider. */
function DoubleRule() {
  return (
    <div className="mb-6" aria-hidden="true">
      <div style={{ borderTop: "2px solid var(--color-accent)" }} />
      <div style={{ height: "3px" }} />
      <div style={{ borderTop: "1px solid var(--color-accent-hover)" }} />
    </div>
  );
}

/** Typographic ornament row replacing emoji decorations. */
function OrnamentRow({ variant }: { variant: "top" | "bottom" }) {
  if (variant === "top") {
    return (
      <div
        className="flex justify-center items-center gap-6 mb-5 select-none text-[var(--color-text-secondary)]"
        aria-hidden="true"
        style={{
          fontFamily: "var(--font-header)",
          fontSize: "14px",
          letterSpacing: "0.3em",
        }}
      >
        <span>◆</span>
        <span>◆</span>
        <span>◆</span>
      </div>
    );
  }

  return (
    <div
      className="flex justify-center items-center gap-3 select-none text-[var(--color-text-secondary)]"
      aria-hidden="true"
      style={{ fontFamily: "var(--font-header)", fontSize: "14px" }}
    >
      <span
        className="flex-1"
        style={{ borderTop: "1px solid var(--color-accent-hover)" }}
      />
      <span style={{ letterSpacing: "0.2em" }}>— § —</span>
      <span
        className="flex-1"
        style={{ borderTop: "1px solid var(--color-accent-hover)" }}
      />
    </div>
  );
}

/** Kicker label (replaces colored badge chips). */
function Kicker({ category }: { category: string }) {
  return (
    <span
      className="inline-block mb-4 px-2.5 py-1"
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: "10px",
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.15em",
        color: "#fff",
        backgroundColor: "var(--color-accent)",
      }}
    >
      {category}
    </span>
  );
}

/** Byline in mono uppercase. */
function Byline({
  byline,
  centered,
}: {
  byline?: string | null;
  centered?: boolean;
}) {
  if (!byline) return null;
  const parts: string[] = [];
  if (byline) parts.push(`By ${byline}`);

  return (
    <p
      className={centered ? "text-center" : ""}
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: "11px",
        fontWeight: 400,
        textTransform: "uppercase",
        letterSpacing: "0.12em",
        color: "var(--color-accent)",
        marginBottom: centered ? "1rem" : "0.75rem",
      }}
    >
      {parts.join("  ·  ")}
    </p>
  );
}

/** Article image with consistent sizing — placed outside CSS columns. */
function ArticleImage({
  src,
  alt,
  caption,
  onClick,
  priority,
  width = 240,
}: {
  src: string;
  alt: string;
  caption?: string | null;
  onClick: () => void;
  priority?: boolean;
  width?: number | "full";
}) {
  return (
    <div style={{ width: width === "full" ? "100%" : `${width}px`, maxWidth: "100%", flexShrink: 0 }}>
      <div
        className="relative border border-[var(--color-border-default)] overflow-hidden cursor-pointer"
        style={{ width: "100%", aspectRatio: "4/3" }}
        onClick={onClick}
      >
        <Image
          src={src}
          alt={alt}
          fill
          className="object-cover"
          priority={priority}
        />
      </div>
      {caption && (
        <p
          className="mt-1"
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "12px",
            fontStyle: "italic",
            color: "var(--color-text-secondary)",
          }}
        >
          {caption}
        </p>
      )}
    </div>
  );
}

/** Multi-column text block for body paragraphs. */
function ColumnText({
  paragraphs,
  columns,
  fontSize = "14px",
  dropCap,
  image,
}: {
  paragraphs: string[];
  columns: 2 | 3;
  fontSize?: string;
  dropCap?: boolean;
  image?: React.ReactNode;
}) {
  if (paragraphs.length === 0 && !image) return null;
  return (
    <div
      className="text-[var(--color-text-primary)]"
      style={{
        fontFamily: "var(--font-body)",
        fontSize,
        lineHeight: 1.7,
        columns: columns === 3 ? "3 200px" : "2 220px",
        columnGap: "1.5rem",
        columnRule: "1px solid var(--stroke-accent-soft)",
        textAlign: "justify",
        hyphens: "auto",
      }}
    >
      {image && (
        <div style={{ breakInside: "avoid", marginBottom: "0.75rem" }}>
          {image}
        </div>
      )}
      {paragraphs.map((p, i) =>
        dropCap && i === 0 ? (
          <DropCap key={i} text={p} />
        ) : (
          <p key={i} className="mb-3">
            {p}
          </p>
        )
      )}
    </div>
  );
}

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
      <AnimatePresence>
        {lightboxSrc && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 cursor-pointer"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeLightbox}
          >
            <motion.div
              className="relative max-w-[90vw] max-h-[90vh]"
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.85, opacity: 0 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={lightboxSrc}
                alt="Full-size view"
                className="max-w-[90vw] max-h-[90vh] object-contain border-4 border-[var(--color-border-default)] shadow-2xl"
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
