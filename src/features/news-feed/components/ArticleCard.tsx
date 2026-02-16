"use client";

import React, { useRef } from "react";
import type { Article } from "@/src/types";
import { Share2, Printer, Check, FileText, ChevronDown } from "lucide-react";
import Image from "next/image";

/**
 * Basic HTML sanitizer — strips dangerous tags and event-handler attributes.
 * Sufficient for OCR-generated HTML; for user-generated content, use DOMPurify.
 */
function sanitizeHtml(html: string): string {
    // Remove <script>, <style>, <iframe>, <object>, <embed>, <form> tags and their content
    let clean = html.replace(/<(script|style|iframe|object|embed|form)[^>]*>[\s\S]*?<\/\1>/gi, "");
    // Remove self-closing dangerous tags
    clean = clean.replace(/<(script|iframe|object|embed|form)[^>]*\/>/gi, "");
    // Remove on* event handler attributes
    clean = clean.replace(/\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi, "");
    // Remove javascript: URIs
    clean = clean.replace(/(href|src|action)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, "$1=$2#$2");
    return clean;
}

interface ArticleCardProps {
    article: Article;
    isExpanded: boolean;
    onToggle: () => void;
    onViewOriginal?: (article: Article) => void;
}

export const ArticleCard: React.FC<ArticleCardProps> = ({
    article,
    isExpanded,
    onToggle,
    onViewOriginal,
}) => {
    const [shareStatus, setShareStatus] = React.useState<"idle" | "copied">("idle");
    const author = article.byline || null;
    const page = article.page || null;
    const fullText = typeof article.fullText === "string" ? article.fullText : "";
    const summary = typeof article.summary === "string" ? article.summary : "";
    const hasFullText = fullText.trim().length > 0;
    const hasSummary = summary.trim().length > 0;
    const articleRef = useRef<HTMLElement>(null);

    const handleClick = () => {
        onToggle();
    };

    const handlePrint = (e: React.MouseEvent) => {
        e.stopPropagation();
        // Use the browser's native print with a temporary printable container
        const printContent = [
            `<h1>${article.headline}</h1>`,
            `<div class="meta">${article.category} \u2022 ${article.date}${author ? ` \u2022 By ${author}` : ""}${page ? ` \u2022 Page ${page}` : ""}</div>`,
            ...article.imageUrls.map(url => `<img src="${url}" alt="${article.headline}" style="max-width:100%;height:auto" />`).join('\n'),
            `<div class="content">${fullText || summary}</div>`,
        ].join("\n");

        const printWindow = window.open("", "_blank");
        if (printWindow) {
            printWindow.document.open();
            printWindow.document.write(`<!DOCTYPE html><html><head><title>${article.headline} - The Transcript</title><style>body{font-family:Georgia,serif;max-width:700px;margin:40px auto;padding:20px;line-height:1.6}h1{font-size:28px;margin-bottom:8px}.meta{font-size:12px;color:#666;margin-bottom:20px;text-transform:uppercase;letter-spacing:.1em}.content{font-size:16px}img{max-width:100%;height:auto;margin:20px 0}</style></head><body>${printContent}</body></html>`);
            printWindow.document.close();
            printWindow.focus();
            printWindow.print();
        }
    };

    const handleShare = async (e: React.MouseEvent) => {
        e.stopPropagation();
        const shareData = {
            title: article.headline,
            text: summary || article.headline,
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
                `${article.headline}\n\n${summary}\n\nRead more: ${window.location.href}`
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
        <article
            ref={articleRef}
            onClick={handleClick}
            onKeyDown={handleKeyDown}
            tabIndex={0}
            role="button"
            className={`
                article-card group relative overflow-hidden cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]
                px-5 md:px-6
                ${isExpanded ? 'is-expanded' : ''}
            `}
        >
            {/* Header Section */}
            <div className="card-header-flex flex gap-6">
                <div className="card-content flex-1">
                    <h2 className="card-headline">
                        {article.headline}
                    </h2>

                    {author && (
                        <p className="card-byline">
                            By {author}
                        </p>
                    )}

                    {hasSummary && (
                        <div className="card-summary-grid">
                            <p className="card-summary line-clamp-2 pointer-events-none">
                                {summary}
                            </p>
                        </div>
                    )}
                </div>

                {/* Thumbnail — right side */}
                {article.imageUrls.length > 0 && (
                    <div className="card-image-column shrink-0">
                        <div className="card-image-container relative aspect-square">
                            <Image
                                src={article.imageUrls[0]}
                                alt={article.headline}
                                fill
                                className="card-image object-cover"
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* Footer — READ FULL STORY right-aligned */}
            <div className="card-footer">
                <span className="card-read-more">
                    Read full story <ChevronDown size={14} className="inline align-middle" />
                </span>
                <div className="card-meta flex items-center gap-2 flex-wrap">
                    <span className="card-category">{article.category}</span>
                    <span>&middot;</span>
                    <span>{article.date}</span>
                    {page && (
                        <>
                            <span>&middot;</span>
                            {onViewOriginal ? (
                                <button
                                    onClick={(e) => { e.stopPropagation(); onViewOriginal(article); }}
                                    className="flex items-center gap-1 hover:text-[var(--color-accent)] transition-colors"
                                    title="View original newspaper scan"
                                >
                                    <FileText size={10} /> Pg. {page}
                                </button>
                            ) : (
                                <span>Pg. {page}</span>
                            )}
                        </>
                    )}
                </div>
            </div>

            {/* Expanded Content */}
            <div className="card-expanded-grid">
                <div
                    className="card-expanded-inner pt-6 border-t border-dashed space-y-4"
                    style={{ borderColor: "var(--stroke-accent-soft)" }}
                    aria-hidden={!isExpanded}
                >
                    {/* Expanded Images */}
                    {article.imageUrls.length > 0 && (
                        article.imageUrls.length === 1 ? (
                            <div className="relative w-full aspect-video mb-6 bg-black/5">
                                <Image
                                    src={article.imageUrls[0]}
                                    alt={article.headline}
                                    fill
                                    className="object-contain object-left sepia-vintage"
                                />
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 gap-3 mb-6">
                                {article.imageUrls.map((url, idx) => (
                                    <div key={idx} className="relative w-full aspect-[4/3] bg-black/5">
                                        <Image
                                            src={url}
                                            alt={`${article.headline} — image ${idx + 1}`}
                                            fill
                                            className="object-contain sepia-vintage"
                                        />
                                    </div>
                                ))}
                            </div>
                        )
                    )}

                    {hasFullText ? (
                        <div
                            className="prose prose-lg prose-invert max-w-none font-body leading-relaxed prose-p:my-3 prose-li:my-1 wrap-break-word"
                            dangerouslySetInnerHTML={{ __html: sanitizeHtml(fullText) }}
                        />
                    ) : hasSummary ? (
                        <p className="prose prose-lg prose-invert max-w-none font-body leading-relaxed">
                            {summary}
                        </p>
                    ) : (
                        <p className="prose prose-lg prose-invert max-w-none font-body leading-relaxed italic opacity-80">
                            Full story text unavailable for this article.
                        </p>
                    )}

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
                </div>
            </div>

        </article>
    );
};
