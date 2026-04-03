"use client";

import React, { useEffect, useRef } from "react";
import type { Article } from "@/src/types";
import { Share2, Printer, Check, FileText, ChevronDown } from "lucide-react";
import Image from "next/image";

/**
 * Basic HTML sanitizer — strips dangerous tags and event-handler attributes.
 * Sufficient for OCR-generated HTML; for user-generated content, use DOMPurify.
 */
function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function isSafeImageUrl(url: string): boolean {
    return url.startsWith("/") || url.startsWith("https://");
}

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
    const [imgErrors, setImgErrors] = React.useState<Set<string>>(new Set());
    const handleImgError = (url: string) => {
        setImgErrors(prev => new Set(prev).add(url));
    };
    const author = article.byline || null;
    const writerPosition = article.writerPosition || null;
    const page = article.page || null;
    const fullText = typeof article.fullText === "string" ? article.fullText : "";
    const summary = typeof article.summary === "string" ? article.summary : "";
    const hasFullText = fullText.trim().length > 0;
    const hasSummary = summary.trim().length > 0;
    const expandedPanelId = `article-panel-${article.id}`;
    const articleRef = useRef<HTMLElement>(null);
    const shareTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

    useEffect(() => {
        return () => {
            if (shareTimerRef.current) clearTimeout(shareTimerRef.current);
        };
    }, []);

    const handleClick = () => {
        onToggle();
    };

    const handlePrint = (e: React.MouseEvent) => {
        e.stopPropagation();
        // Use the browser's native print with a temporary printable container
        const safeHeadline = escapeHtml(article.headline);
        const safeCategory = escapeHtml(article.category);
        const safeDate = escapeHtml(article.date);
        const safeAuthor = author ? escapeHtml(author) : null;
        const safePage = page ? escapeHtml(String(page)) : null;
        const safeImages = article.imageUrls.filter(isSafeImageUrl);

        const printContent = [
            `<h1>${safeHeadline}</h1>`,
            `<div class="meta">${safeCategory} \u2022 ${safeDate}${safeAuthor ? ` \u2022 By ${safeAuthor}` : ""}${safePage ? ` \u2022 Page ${safePage}` : ""}</div>`,
            ...safeImages.map(url => `<img src="${url}" alt="${safeHeadline}" style="max-width:100%;height:auto" />`),
            `<div class="content">${sanitizeHtml(fullText || summary)}</div>`,
        ].join("\n");

        const printWindow = window.open("", "_blank");
        if (printWindow) {
            printWindow.document.open();
            printWindow.document.write(`<!DOCTYPE html><html><head><title>${safeHeadline} - The Transcript</title><style>body{font-family:var(--font-body);max-width:700px;margin:40px auto;padding:20px;line-height:1.6}h1{font-size:28px;margin-bottom:8px}.meta{font-size:12px;color:#666;margin-bottom:20px;text-transform:uppercase;letter-spacing:.1em}.content{font-size:16px}img{max-width:100%;height:auto;margin:20px 0}</style></head><body>${printContent}</body></html>`);
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
            shareTimerRef.current = setTimeout(() => setShareStatus("idle"), 2000);
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
            className={`
                article-card group relative overflow-hidden
                px-5 md:px-6
                ${isExpanded ? 'is-expanded' : ''}
            `}
        >
            {/* Clickable Header Toggle */}
            <div
                role="button"
                tabIndex={0}
                aria-expanded={isExpanded}
                aria-controls={expandedPanelId}
                aria-label={article.headline}
                onClick={handleClick}
                onKeyDown={handleKeyDown}
                className="cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
            >
                {/* Header Section */}
                <div className="card-header-flex flex gap-6">
                    <div className="card-content flex-1">
                        <h2 className="card-headline">
                            {article.headline}
                        </h2>

                        {author && (
                            <div className="card-byline">
                                <p>By {author}</p>
                                {writerPosition && (
                                    <p className="text-[0.8em] opacity-70">{writerPosition}</p>
                                )}
                            </div>
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
                    {article.imageUrls.length > 0 && !imgErrors.has(article.imageUrls[0]) && (
                        <div className="card-image-column shrink-0">
                            <div className="card-image-container relative aspect-square">
                                <Image
                                    src={article.imageUrls[0]}
                                    alt={article.headline}
                                    fill
                                    className="card-image object-cover"
                                    style={{ objectPosition: "center 20%" }}
                                    onError={() => handleImgError(article.imageUrls[0])}
                                />
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer — READ FULL STORY right-aligned */}
                <div className="card-footer">
                    <span className="card-read-more">
                        {isExpanded ? "Close" : "Read full story"}{" "}
                        <ChevronDown size={14} className="inline align-middle" />
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
            </div>

            {/* Expanded Content */}
            <div className="card-expanded-grid">
                <div
                    id={expandedPanelId}
                    className="card-expanded-inner pt-6 border-t border-dashed space-y-4"
                    style={{ borderColor: "var(--stroke-accent-soft)" }}
                    aria-hidden={!isExpanded}
                >
                    {/* Expanded Images */}
                    {(() => {
                        const validUrls = article.imageUrls.filter(url => !imgErrors.has(url));
                        if (validUrls.length === 0) return null;
                        if (validUrls.length === 1) {
                            const caption = article.imageCaptions?.[
                                article.imageUrls.indexOf(validUrls[0])
                            ];
                            return (
                                <div className="mb-6">
                                    <div className="relative w-full aspect-video bg-black/5">
                                        <Image
                                            src={validUrls[0]}
                                            alt={article.headline}
                                            fill
                                            className="object-contain object-left sepia-vintage"
                                            onError={() => handleImgError(validUrls[0])}
                                        />
                                    </div>
                                    {caption && (
                                        <p className="image-caption text-sm text-left mt-1" style={{ fontStyle: "italic" }}>
                                            {caption}
                                        </p>
                                    )}
                                </div>
                            );
                        }
                        return (
                            <div className="grid grid-cols-2 gap-3 mb-6">
                                {validUrls.map((url, idx) => {
                                    const caption = article.imageCaptions?.[
                                        article.imageUrls.indexOf(url)
                                    ];
                                    return (
                                        <div key={idx}>
                                            <div className="relative w-full aspect-[4/3] bg-black/5">
                                                <Image
                                                    src={url}
                                                    alt={`${article.headline} — image ${idx + 1}`}
                                                    fill
                                                    className="object-contain sepia-vintage"
                                                    onError={() => handleImgError(url)}
                                                />
                                            </div>
                                            {caption && (
                                                <p className="image-caption text-sm text-left mt-1" style={{ fontStyle: "italic" }}>
                                                    {caption}
                                                </p>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        );
                    })()}

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
