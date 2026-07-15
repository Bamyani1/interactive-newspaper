"use client";
import React, { useState, useCallback } from "react";
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
  PhotoFeature,
  ImageGallery,
  Lightbox,
} from "./print-edition-primitives";

// ─── Main Component ────────────────────────────────────────────────

export const TopStoriesPrintEdition: React.FC<TopStoriesVariantProps> = ({
  heroArticle,
  featuredArticles,
}) => {
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const closeLightbox = useCallback(() => setLightboxSrc(null), []);

  return (
    <div className="flex flex-col">
      {/* ── Top double rule ───────────────────────────────────── */}
      <DoubleRule />

      {/* ── Hero Article ──────────────────────────────────────── */}
      {heroArticle && (
        <article className="mb-2">
          {/* Kicker */}
          <Kicker category={heroArticle.category} />

          {/* Image + body text in columns */}
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
                priority
              />
              {heroArticle.imageUrls.length > 1 && (
                <ImageGallery
                  images={heroArticle.imageUrls.slice(1, 2).map((url, i) => ({
                    src: url,
                    caption: heroArticle.imageCaptions?.[i + 1],
                  }))}
                  alt={heroArticle.headline}
                  startIndex={2}
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
                  <Byline byline={heroArticle.byline} writerPosition={heroArticle.writerPosition} />
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

        </article>
      )}

      {/* ── Featured Articles ─────────────────────────────────── */}
      {featuredArticles.length > 0 && (
        <div>
          {featuredArticles.map((article, _index) => {
            const paragraphs = article.fullText
              ? extractParagraphs(article.fullText)
              : [];
            const plainText = paragraphs.join(" ");
            const isLong = plainText.length > LONG_ARTICLE_THRESHOLD;
            const hasImage = article.imageUrls.length > 0;
            const isPhotoOnly = paragraphs.length === 0 && hasImage;
            const isAboveFold = _index === 0;

            return (
              <React.Fragment key={article.id}>
                <article className="py-5">
                  {/* Single rule top */}
                  <div
                    aria-hidden="true"
                    className="mb-4"
                    style={{ borderTop: "2px solid var(--color-accent)" }}
                  />

                  {isPhotoOnly ? (
                    /* ── Photo Feature (no body text) ───────── */
                    <>
                      <Kicker category={article.category} />
                      <PhotoFeature
                        headline={article.headline}
                        imageSrc={article.imageUrls[0]}
                        alt={article.headline}
                        caption={article.imageCaptions?.[0] ?? article.imageCaption}
                        byline={article.byline}
                        onImageClick={() =>
                          setLightboxSrc(article.imageUrls[0])
                        }
                        priority={isAboveFold}
                      />
                      {article.imageUrls.length > 1 && (
                        <ImageGallery
                          images={article.imageUrls.slice(1, 2).map((url, i) => ({
                            src: url,
                            caption: article.imageCaptions?.[i + 1],
                          }))}
                          alt={article.headline}
                          startIndex={2}
                          onClick={(src) => setLightboxSrc(src)}
                        />
                      )}
                    </>
                  ) : isLong ? (
                    /* ── Long Featured Layout ─────────────── */
                    <>
                      <Kicker category={article.category} />

                      {/* All text in 3 columns, image in column flow */}
                      <ColumnText
                        paragraphs={paragraphs}
                        columns={3}
                        header={
                          <>
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
                            <Byline byline={article.byline} writerPosition={article.writerPosition} />
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
                                  priority={isAboveFold && i === 0}
                                  width="full"
                                />
                              ))
                            : undefined
                        }
                      />
                    </>
                  ) : (
                    /* ── Short Featured Layout ────────────── */
                    <>
                      <Kicker category={article.category} />

                      {/* All text in columns, image in column flow */}
                      <ColumnText
                        paragraphs={paragraphs}
                        columns={hasImage ? 3 : 2}
                        header={
                          <>
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
                            <Byline byline={article.byline} writerPosition={article.writerPosition} />
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
                                  priority={isAboveFold && i === 0}
                                  width="full"
                                />
                              ))
                            : undefined
                        }
                      />
                    </>
                  )}
                </article>

              </React.Fragment>
            );
          })}
        </div>
      )}

      {/* ── Bottom Ornament ───────────────────────────────────── */}
      <div className="mt-6 pt-4">
        <OrnamentRow variant="bottom" />
      </div>

      {/* ── Lightbox Overlay ──────────────────────────────────── */}
      <Lightbox src={lightboxSrc} onClose={closeLightbox} />
    </div>
  );
};
