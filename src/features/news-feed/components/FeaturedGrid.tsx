"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
import Image from "next/image";
import { TRANSITIONS } from "@/shared/motion/motionTokens";
import type { Article } from "@/src/types";

interface FeaturedGridProps {
    articles: Article[];
    onArticleClick: (article: Article) => void;
    focusedId?: string | null;
}

export const FeaturedGrid: React.FC<FeaturedGridProps> = ({ articles, onArticleClick, focusedId }) => {
    const [imgErrors, setImgErrors] = useState<Set<string>>(new Set());
    const handleImgError = (url: string) => {
        setImgErrors(prev => new Set(prev).add(url));
    };

    // Take first 3 articles
    const featured = articles.slice(0, 3);

    if (featured.length === 0) return null;

    return (
        <section className="mb-12">
            <div>
                <div className="relative">

                    {/* The String/Bar */}
                    <div className="absolute top-0 left-0 right-0 h-[2px] bg-[var(--color-text-secondary)] shadow-sm z-10"
                        style={{ transform: "translateY(-10px)" }}></div>

                    {/* Container for hanging cards */}
                    <div className="flex flex-wrap md:flex-nowrap justify-center gap-3.5 md:gap-5 pt-5">
                        {featured.map((article, index) => (
                            <motion.article
                                key={article.id}
                                className={`relative flex-1 min-w-[173px] max-w-[230px] cursor-pointer group ${focusedId === article.id ? "ring-2 ring-[var(--color-accent)] ring-offset-2 ring-offset-[var(--color-bg-primary)] rounded-sm" : ""}`}
                                initial={{ opacity: 0, y: 20, rotate: index % 2 === 0 ? -1 : 1 }}
                                animate={{ opacity: 1, y: 0, rotate: index % 2 === 0 ? -1 : 1 }}
                                transition={{
                                    delay: 0.1 * index,
                                    type: "spring",
                                    stiffness: 100,
                                    damping: 18,
                                    mass: 0.8
                                }}
                                whileHover={{
                                    y: -5,
                                    rotate: 0,
                                    zIndex: 20,
                                    transition: TRANSITIONS.quick
                                }}
                                onClick={() => onArticleClick(article)}
                            >
                                {/* The Pin / Clip */}
                                <div className="absolute -top-7 left-1/2 -translate-x-1/2 z-20 w-3.5 h-7 flex flex-col items-center">
                                    <div className="w-0.5 h-3.5 bg-[var(--color-text-secondary)]"></div>
                                    <div className="w-3.5 h-3.5 rounded-full bg-[var(--color-accent)] shadow-md"></div>
                                </div>

                                {/* Card Body */}
                                <div className="bg-[var(--featured-card-bg)] p-2.5 shadow-lg border border-[var(--featured-card-border)] h-full flex flex-col origin-top"
                                >

                                    {/* Image */}
                                    {article.imageUrls.length > 0 && !imgErrors.has(article.imageUrls[0]) ? (
                                        <div className="relative aspect-[4/3] w-full overflow-hidden mb-2.5 border border-[var(--color-border-default)]">
                                            <Image
                                                src={article.imageUrls[0]}
                                                alt={article.headline}
                                                fill
                                                className="object-cover transition-all duration-500"
                                                onError={() => handleImgError(article.imageUrls[0])}
                                            />
                                            <div className="absolute top-1.5 right-1.5 px-1.5 py-0.5 bg-[color-mix(in_srgb,var(--color-bg-primary)_80%,transparent)] text-[var(--color-text-primary)] text-[8px] uppercase tracking-widest font-bold font-typewriter backdrop-blur-sm">
                                                {article.category}
                                            </div>
                                        </div>
                                    ) : (
                                        /* No Image Placeholder or different layout */
                                        <div className="mb-2.5 flex justify-end">
                                            <div className="px-1.5 py-0.5 bg-[var(--color-accent)] text-[var(--color-text-primary)] text-[8px] uppercase tracking-widest font-bold font-typewriter">
                                                {article.category}
                                            </div>
                                        </div>
                                    )}

                                    {/* Content */}
                                    <div className="flex-1 flex flex-col">
                                        <h3 className="font-header text-base font-bold leading-tight mb-1.5 text-[var(--featured-text-primary)] group-hover:text-[var(--featured-text-hover)] transition-colors line-clamp-3">
                                            {article.headline}
                                        </h3>
                                        <p className="font-typewriter text-[11px] text-[var(--color-text-secondary)] leading-normal line-clamp-3 mb-2.5 flex-1">
                                            {article.summary}
                                        </p>

                                        <div className="pt-1.5 border-t border-[var(--featured-card-border)] mt-auto flex justify-between items-center text-[9px] text-[var(--color-text-secondary)] font-mono uppercase tracking-wide">
                                            <span>{article.byline?.split(",")[0] || "Staff"}</span>
                                            <span>Pg. {article.page || 1}</span>
                                        </div>
                                    </div>
                                </div>
                            </motion.article>
                        ))}
                    </div>
                </div>
            </div>
        </section>
    );
};
