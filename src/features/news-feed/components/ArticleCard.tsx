"use client";

import React, { useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Article } from "../data/mockData";
import { ChevronDown, ChevronUp, Share2, Printer, Check } from "lucide-react";
import Image from "next/image";
import { getArticleAuthor, getArticlePage } from "../lib/articleUtils";

interface ArticleCardProps {
    article: Article;
    isExpanded?: boolean;
    onToggle?: () => void;
    onViewOriginal?: (article: Article) => void;
}

export const ArticleCard: React.FC<ArticleCardProps> = ({
    article,
    isExpanded: controlledExpanded,
    onToggle,
    onViewOriginal,
}) => {
    // Support both controlled and uncontrolled modes
    const [internalExpanded, setInternalExpanded] = React.useState(false);
    const [shareStatus, setShareStatus] = React.useState<"idle" | "copied">("idle");
    const isExpanded = controlledExpanded ?? internalExpanded;
    const author = getArticleAuthor(article);
    const page = getArticlePage(article);
    const articleRef = useRef<HTMLElement>(null);

    // Auto-scroll into view when expanded
    useEffect(() => {
        if (isExpanded && articleRef.current) {
            // Small delay to let the expansion animation start
            setTimeout(() => {
                articleRef.current?.scrollIntoView({
                    behavior: "smooth",
                    block: "start",
                });
            }, 100);
        }
    }, [isExpanded]);

    const handleClick = () => {
        if (onToggle) {
            onToggle();
        } else {
            setInternalExpanded(!internalExpanded);
        }
    };

    const handlePrint = (e: React.MouseEvent) => {
        e.stopPropagation();
        // Create a printable version
        const printContent = `
            <html>
                <head>
                    <title>${article.headline} - The Transcript</title>
                    <style>
                        body { font-family: Georgia, serif; max-width: 700px; margin: 40px auto; padding: 20px; line-height: 1.6; }
                        h1 { font-size: 28px; margin-bottom: 8px; }
                        .meta { font-size: 12px; color: #666; margin-bottom: 20px; text-transform: uppercase; letter-spacing: 0.1em; }
                        .content { font-size: 16px; }
                        img { max-width: 100%; height: auto; margin: 20px 0; }
                        @media print { body { margin: 0; padding: 20px; } }
                    </style>
                </head>
                <body>
                    <h1>${article.headline}</h1>
                    <div class="meta">
                        ${article.category} • ${article.date}${author ? ` • By ${author}` : ""}${page ? ` • Page ${page}` : ""}
                    </div>
                    ${article.imageUrl ? `<img src="${article.imageUrl}" alt="${article.headline}" />` : ""}
                    <div class="content">${article.fullText}</div>
                </body>
            </html>
        `;
        const printWindow = window.open("", "_blank");
        if (printWindow) {
            printWindow.document.write(printContent);
            printWindow.document.close();
            printWindow.print();
        }
    };

    const handleShare = async (e: React.MouseEvent) => {
        e.stopPropagation();
        const shareData = {
            title: article.headline,
            text: article.summary || article.headline,
            url: window.location.href,
        };

        // Try Web Share API first
        if (navigator.share) {
            try {
                await navigator.share(shareData);
                return;
            } catch {
                // User cancelled or error - fall through to clipboard
            }
        }

        // Fallback to clipboard
        try {
            await navigator.clipboard.writeText(
                `${article.headline}\n\n${article.summary}\n\nRead more: ${window.location.href}`
            );
            setShareStatus("copied");
            setTimeout(() => setShareStatus("idle"), 2000);
        } catch {
            // Clipboard failed silently
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleClick();
        }
    };

    return (
        <motion.article
            ref={articleRef}
            onClick={handleClick}
            onKeyDown={handleKeyDown}
            tabIndex={0}
            role="button"
            className={`
                article-card group relative overflow-hidden cursor-pointer transition-all duration-300 outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]
                px-5 md:px-6 py-6 md:py-8
                ${isExpanded ? 'is-expanded' : ''}
            `}
        >
            {/* Header Section */}
            <div className="card-header-flex flex gap-6 items-start">
                <div className="card-content flex-1 space-y-2 pl-2 md:pl-3">
                    <div className="card-meta flex items-center gap-2 flex-wrap">
                        <span>{article.category}</span>
                        <span>•</span>
                        <span>{article.date}</span>
                        {page && (
                            <>
                                <span>•</span>
                                <span>Pg. {page}</span>
                            </>
                        )}
                    </div>

                    <h2 className="card-headline">
                        {article.headline}
                    </h2>

                    {author && (
                        <p className="text-xs uppercase tracking-[0.2em] font-semibold opacity-80">
                            By {author}
                        </p>
                    )}

                    <motion.p
                        layout="position"
                        animate={{ opacity: isExpanded ? 0 : 1 }}
                        transition={{ duration: 0.18, ease: "easeOut" }}
                        aria-hidden={isExpanded}
                        style={{ visibility: isExpanded ? "hidden" : "visible" }}
                        className="card-summary line-clamp-2 min-h-[48px] pointer-events-none"
                    >
                        {article.summary}
                    </motion.p>

                    {article.continuesOnPage && (
                        <p className="text-xs font-mono uppercase tracking-widest opacity-60">
                            Continued on page {article.continuesOnPage}
                        </p>
                    )}
                </div>

                {/* Thumbnail */}
                {article.imageUrl && (
                    <div className="card-image-container w-[120px] aspect-square relative shrink-0 transition-all duration-500">
                        <Image
                            src={article.imageUrl}
                            alt={article.headline}
                            fill
                            className="card-image object-cover"
                        />
                    </div>
                )}
            </div>

            {/* Expanded Content */}
            <AnimatePresence>
                {isExpanded && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.3, ease: "easeOut" }}
                        className="mt-6 border-t border-dashed pt-6 space-y-4"
                        style={{ borderColor: "var(--stroke-accent-soft)" }}
                    >
                        {/* Expanded Image */}
                        {article.imageUrl && (
                            <div className="relative w-full aspect-video mb-6 bg-black/5">
                                <Image
                                    src={article.imageUrl}
                                    alt={article.headline}
                                    fill
                                    className="object-contain object-left sepia-vintage mix-blend-multiply"
                                />
                            </div>
                        )}

                        <div
                            className="prose prose-lg max-w-none font-body leading-relaxed prose-p:my-3 prose-li:my-1 wrap-break-word"
                            dangerouslySetInnerHTML={{ __html: article.fullText }}
                        />

                        {article.imageCaption && (
                            <p className="image-caption text-sm text-left">
                                {article.imageCaption}
                            </p>
                        )}

                        <div
                            className="flex flex-wrap gap-4 mt-8 pt-4 border-t justify-end opacity-80"
                            style={{ borderColor: "var(--stroke-accent-soft)" }}
                        >
                            {onViewOriginal && (
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onViewOriginal(article);
                                    }}
                                    className="flex items-center gap-2 text-sm hover:opacity-100"
                                >
                                    View Original
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={handlePrint}
                                className="flex items-center gap-2 text-sm hover:opacity-100"
                            >
                                <Printer size={16} /> Print
                            </button>
                            <button
                                type="button"
                                onClick={handleShare}
                                className="flex items-center gap-2 text-sm hover:opacity-100"
                            >
                                {shareStatus === "copied" ? (
                                    <>
                                        <Check size={16} className="text-green-600" /> Copied!
                                    </>
                                ) : (
                                    <>
                                        <Share2 size={16} /> Share
                                    </>
                                )}
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Toggle Icon Hint */}
            <motion.div layout className="absolute top-6 right-0 opacity-40 group-hover:opacity-60 transition-opacity">
                {isExpanded ? <ChevronUp /> : <ChevronDown />}
            </motion.div>

        </motion.article>
    );
};
