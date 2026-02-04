"use client";

import React from "react";
import { motion } from "framer-motion";
import Image from "next/image";
import { Article } from "../data/mockData";
import { getArticleAuthor } from "../lib/articleUtils";

interface FeaturedGridProps {
    articles: Article[];
    onArticleClick: (article: Article) => void;
}

export const FeaturedGrid: React.FC<FeaturedGridProps> = ({ articles, onArticleClick }) => {
    // Take first 4 articles
    const featured = articles.slice(0, 4);

    if (featured.length === 0) return null;

    return (
        <section className="mb-20 px-4 md:px-8">
            <div className="max-w-7xl mx-auto">
                <div className="relative">

                    {/* The String/Bar */}
                    <div className="absolute top-0 left-6 right-6 h-[2px] bg-[var(--color-text-secondary)] shadow-sm z-10"
                        style={{ transform: "translateY(-10px)" }}></div>

                    {/* Container for hanging cards */}
                    <div className="flex flex-wrap md:flex-nowrap justify-center gap-4 md:gap-6 pt-6">
                        {featured.map((article, index) => (
                            <motion.article
                                key={article.id}
                                className="relative flex-1 min-w-[192px] max-w-[240px] cursor-pointer group"
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{
                                    delay: 0.1 * index,
                                    type: "spring",
                                    stiffness: 100
                                }}
                                whileHover={{
                                    y: -5,
                                    zIndex: 20,
                                    transition: { duration: 0.2 }
                                }}
                                onClick={() => onArticleClick(article)}
                            >
                                {/* The Pin / Clip */}
                                <div className="absolute -top-8 left-1/2 -translate-x-1/2 z-20 w-4 h-8 flex flex-col items-center">
                                    <div className="w-1 h-4 bg-[var(--color-text-secondary)]"></div>
                                    <div className="w-4 h-4 rounded-full bg-[var(--color-accent)] shadow-md"></div>
                                </div>

                                {/* Card Body */}
                                <div className="bg-[var(--featured-card-bg)] p-3 shadow-lg border border-[var(--featured-card-border)] h-full flex flex-col transform transition-transform duration-300 group-hover:rotate-0 origin-top"
                                    style={{ transform: `rotate(${index % 2 === 0 ? '-1deg' : '1deg'})` }}
                                >

                                    {/* Image */}
                                    {article.imageUrl ? (
                                        <div className="relative aspect-[4/3] w-full overflow-hidden mb-3 border border-[var(--color-border-default)]">
                                            <Image
                                                src={article.imageUrl}
                                                alt={article.headline}
                                                fill
                                                className="object-cover filter sepia-[.2] contrast-110 group-hover:sepia-0 transition-all duration-500"
                                            />
                                            <div className="absolute top-2 right-2 px-2 py-0.5 bg-[color-mix(in_srgb,var(--color-bg-primary)_80%,transparent)] text-[var(--color-text-primary)] text-[9px] uppercase tracking-widest font-bold font-typewriter backdrop-blur-sm">
                                                {article.category}
                                            </div>
                                        </div>
                                    ) : (
                                        /* No Image Placeholder or different layout */
                                        <div className="mb-3 flex justify-end">
                                            <div className="px-2 py-0.5 bg-[var(--color-accent)] text-[var(--color-text-primary)] text-[9px] uppercase tracking-widest font-bold font-typewriter">
                                                {article.category}
                                            </div>
                                        </div>
                                    )}

                                    {/* Content */}
                                    <div className="flex-1 flex flex-col">
                                        <h3 className="font-header text-lg font-bold leading-tight mb-2 text-[var(--featured-text-primary)] group-hover:text-[var(--featured-text-hover)] transition-colors line-clamp-3">
                                            {article.headline}
                                        </h3>
                                        <p className="font-typewriter text-xs text-[var(--color-text-secondary)] leading-normal line-clamp-3 mb-3 flex-1">
                                            {article.summary}
                                        </p>

                                        <div className="pt-2 border-t border-[var(--featured-card-border)] mt-auto flex justify-between items-center text-[10px] text-[var(--color-text-secondary)] font-sans uppercase tracking-wide">
                                            <span>{getArticleAuthor(article)?.split(",")[0] || "Staff"}</span>
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
