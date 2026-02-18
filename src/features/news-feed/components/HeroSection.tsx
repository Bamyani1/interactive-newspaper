"use client";

import React, { useState } from "react";
import Image from "next/image";
import type { Article } from "@/src/types";
import { ChevronDown } from "lucide-react";

interface HeroSectionProps {
    article: Article;
    onReadMore: () => void;
    isFocused?: boolean;
}

export const HeroSection: React.FC<HeroSectionProps> = ({ article, onReadMore, isFocused }) => {
    const [imgError, setImgError] = useState(false);
    const author = article.byline || null;
    const page = article.page || null;
    const hasImage = article.imageUrls.length > 0;

    return (
        <section
            className={`relative w-full mb-8 hero-article bg-[var(--featured-card-bg)]/60 border border-[var(--featured-card-border)] px-5 md:px-6 py-5 md:py-6 border-b-2 border-b-[var(--color-accent)] ${isFocused ? "ring-2 ring-[var(--color-accent)] ring-offset-2 ring-offset-[var(--color-bg-primary)]" : ""}`}
        >
            {/* Main Row: photo left, content right */}
            <div className="flex flex-col sm:flex-row gap-5 items-start">
                {/* Photo + Caption */}
                {hasImage && !imgError && (
                    <div className="shrink-0">
                        <div className="relative w-[220px] md:w-[260px] aspect-[4/3] border border-[var(--color-border-default)] overflow-hidden">
                            <Image
                                src={article.imageUrls[0]}
                                alt={article.headline}
                                fill
                                className="object-cover"
                                priority
                                onError={() => setImgError(true)}
                            />
                        </div>
                        {article.imageCaption && (
                            <p className="mt-1.5 font-body text-sm italic text-[var(--color-text-secondary)] opacity-65 leading-snug max-w-[260px]">
                                {article.imageCaption.match(/^(.*?)\s*(Photo by.*)$/i)
                                    ? (<>{article.imageCaption.match(/^(.*?)\s*(Photo by.*)$/i)![1]}<br />{article.imageCaption.match(/^(.*?)\s*(Photo by.*)$/i)![2]}</>)
                                    : article.imageCaption
                                }
                            </p>
                        )}
                    </div>
                )}

                {/* Content Column */}
                <div className="flex-1 space-y-2">
                    {/* Meta Strip */}
                    <div className="flex items-center gap-2 flex-wrap font-mono text-[10px] uppercase tracking-[0.15em]">
                        <span className="text-[var(--color-accent)] font-bold">{article.category}</span>
                        <span aria-hidden="true" className="text-[var(--color-text-secondary)]">·</span>
                        <span className="text-[var(--color-text-secondary)]">{article.date}</span>
                        {page && (
                            <>
                                <span aria-hidden="true" className="text-[var(--color-text-secondary)]">·</span>
                                <span className="text-[var(--color-text-secondary)]">Pg. {page}</span>
                            </>
                        )}
                    </div>

                    {/* Headline */}
                    <h1 className="font-header text-2xl md:text-3xl text-[var(--color-text-primary)] leading-snug">
                        {article.headline}
                    </h1>

                    {/* Byline */}
                    {author && (
                        <p className="text-[11px] uppercase tracking-[0.12em] opacity-60">
                            By {author}
                        </p>
                    )}

                    {/* Summary */}
                    <p className="font-body text-base md:text-lg leading-relaxed text-[var(--color-text-secondary)] line-clamp-2">
                        {article.summary}
                    </p>
                </div>
            </div>

            {/* Read More */}
            <div className="flex justify-end mt-3">
                <button
                    onClick={onReadMore}
                    className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] transition-colors"
                >
                    Read Full Story
                    <ChevronDown size={14} />
                </button>
            </div>
        </section>
    );
};
