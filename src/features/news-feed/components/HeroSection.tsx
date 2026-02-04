"use client";

import React from "react";
import { motion } from "framer-motion";
import Image from "next/image";
import { Article } from "../data/mockData";
import { ChevronDown } from "lucide-react";
import { getArticleAuthor, getArticlePage } from "../lib/articleUtils";

interface HeroSectionProps {
    article: Article;
    onReadMore: () => void;
}

export const HeroSection: React.FC<HeroSectionProps> = ({ article, onReadMore }) => {
    const author = getArticleAuthor(article);
    const page = getArticlePage(article);

    return (
        <section className="relative w-full max-w-4xl mx-auto mb-8 hero-article overflow-hidden border border-[var(--color-text-primary)]/20">
            {/* Hero Image Container */}
            <div className="relative w-full aspect-[16/9] md:aspect-[21/9] overflow-hidden">
                {article.imageUrl && (
                    <Image
                        src={article.imageUrl}
                        alt={article.headline}
                        fill
                        className="object-cover"
                        priority
                    />
                )}
                {/* Gradient Overlay */}
                <div
                    className="absolute inset-0"
                    style={{
                        background: "linear-gradient(to top, color-mix(in srgb, var(--color-bg-primary) 85%, transparent) 0%, color-mix(in srgb, var(--color-bg-primary) 45%, transparent) 55%, transparent 100%)",
                    }}
                />

                {/* Content Overlay */}
                <div className="absolute inset-0 flex flex-col justify-end p-6 md:p-10 lg:p-12">
                    {/* Category Badge */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.1 }}
                        className="mb-3"
                    >
                        <span className="inline-block px-3 py-1 bg-[var(--color-accent)] text-[var(--color-text-primary)] text-xs uppercase tracking-widest font-bold">
                            {article.category}
                        </span>
                    </motion.div>

                    {/* Headline */}
                    <motion.h1
                        initial={{ opacity: 0, y: 30 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2 }}
                        className="font-header text-3xl md:text-4xl lg:text-5xl text-[var(--color-text-primary)] leading-tight mb-4 max-w-4xl"
                    >
                        {article.headline}
                    </motion.h1>

                    {/* Summary */}
                    <motion.p
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.3 }}
                        className="text-[color-mix(in_srgb,var(--color-text-primary)_85%,transparent)] text-lg md:text-xl max-w-3xl mb-4 leading-relaxed"
                    >
                        {article.summary}
                    </motion.p>

                    {/* Byline & Date */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.4 }}
                        className="flex items-center gap-4 text-[color-mix(in_srgb,var(--color-text-primary)_65%,transparent)] text-sm uppercase tracking-wide flex-wrap"
                    >
                        {author && <span>By {author}</span>}
                        <span aria-hidden="true">•</span>
                        <span>{article.date}</span>
                        {page && (
                            <>
                                <span aria-hidden="true">•</span>
                                <span>Page {page}</span>
                            </>
                        )}
                    </motion.div>
                </div>
            </div>

            {article.imageCaption && (
                <div className="px-4 py-3 bg-[var(--color-text-primary)] text-[var(--color-text-inverse)] text-sm image-caption">
                    {article.imageCaption}
                </div>
            )}

            {/* Read More Button */}
            <motion.button
                onClick={onReadMore}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5 }}
                className="absolute bottom-4 right-4 md:bottom-8 md:right-8 flex items-center gap-2 px-4 py-2 bg-[color-mix(in_srgb,var(--color-text-primary)_10%,transparent)] backdrop-blur-sm border border-[color-mix(in_srgb,var(--color-text-primary)_25%,transparent)] text-[var(--color-text-primary)] hover:bg-[color-mix(in_srgb,var(--color-text-primary)_18%,transparent)] transition-colors rounded"
            >
                Read Full Story
                <ChevronDown size={16} />
            </motion.button>
        </section>
    );
};
