"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import type { AskResponse } from "@/src/types";
import { markExplicitEditionNavigation } from "@/shared/navigation/editionNavigation";
import { useModalDialog } from "@/shared/ui/useModalDialog";
import { SourcePhotosStrip } from "./SourcePhotosStrip";

type SourceArticle = AskResponse["sourceArticles"][number];

interface SourceReaderProps {
    source: SourceArticle | null;
    onClose: () => void;
}

interface EditionArticle {
    id: string;
    headline: string;
    byline: string | null;
    fullText: string | null;
    category: string;
    page: number | null;
}

const paragraphsFrom = (text: string | null | undefined): string[] => {
    if (!text) return [];
    // Article bodies from the OCR pipeline come as HTML: "<p>…</p> <p>…</p>".
    // Parse with DOMParser so any inline tags collapse to clean text content.
    if (/<p[\s>]/i.test(text)) {
        const doc = new DOMParser().parseFromString(
            `<div>${text}</div>`,
            "text/html",
        );
        const ps = Array.from(doc.querySelectorAll("p"));
        const paras = ps
            .map((p) => p.textContent?.trim() ?? "")
            .filter((p) => p.length > 0);
        if (paras.length > 0) return paras;
    }
    // Fall back to plain-text paragraph split for bodies without <p> markup.
    return text
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
};

export const SourceReader: React.FC<SourceReaderProps> = ({
    source,
    onClose,
}) => {
    const [mounted, setMounted] = useState(false);
    const [article, setArticle] = useState<EditionArticle | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const cacheRef = useRef<Map<string, EditionArticle[]>>(new Map());
    const closeButtonRef = useRef<HTMLButtonElement>(null);
    const titleId = useId();
    const { portalRef, dialogRef } = useModalDialog({
        isOpen: mounted && source !== null,
        onDismiss: onClose,
        initialFocusRef: closeButtonRef,
    });

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- SSR→client mount flag; required so the portal target (document.body) only renders post-hydration.
        setMounted(true);
    }, []);

    // Fetch the full edition, then pick the article by id. Cache per-date
    // so tapping around several sources inside the same edition doesn't
    // refetch. When source is null the drawer is closed; the JSX below
    // renders nothing, so leaving stale state alone is fine.
    useEffect(() => {
        if (!source) return undefined;
        const cached = cacheRef.current.get(source.editionDate);
        if (cached) {
            const match = cached.find((a) => a.id === source.id);
            // eslint-disable-next-line react-hooks/set-state-in-effect -- cache-hit sync: hydrate article state from an in-memory cache keyed by source.id; avoiding the network hop requires setting state here.
            setArticle(match ?? null);
            setError(match ? null : "Article not found in this edition.");
            return undefined;
        }
        let cancelled = false;
        setLoading(true);
        setError(null);
        fetch(`/api/editions/${source.editionDate}`)
            .then((res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            })
            .then((data: { articles: EditionArticle[] }) => {
                if (!cancelled) {
                    cacheRef.current.set(source.editionDate, data.articles);
                    const match = data.articles.find(
                        (a) => a.id === source.id,
                    );
                    setArticle(match ?? null);
                    setError(
                        match ? null : "Article not found in this edition.",
                    );
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setError("Unable to load this article right now.");
                }
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [source]);

    if (!mounted || !source) return null;

    const paragraphs = paragraphsFrom(article?.fullText);

    return createPortal(
        <div
            ref={portalRef}
            className="ask-reader-overlay"
            data-open="true"
            onClick={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <div
                ref={dialogRef}
                className="ask-reader"
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
            >
                <button
                    ref={closeButtonRef}
                    type="button"
                    className="ask-reader-close"
                    onClick={onClose}
                    aria-label="Close article reader"
                >
                    Close ✕
                </button>

                <>
                        <div className="ask-reader-dateline">
                            <span className="ask-reader-section">
                                {source.category}
                            </span>
                            <span className="ask-reader-dot" aria-hidden="true">
                                ·
                            </span>
                            <span className="ask-reader-date">
                                {source.editionDate}
                            </span>
                            {article?.page ? (
                                <>
                                    <span
                                        className="ask-reader-dot"
                                        aria-hidden="true"
                                    >
                                        ·
                                    </span>
                                    <span className="ask-reader-page">
                                        p. {article.page}
                                    </span>
                                </>
                            ) : null}
                        </div>

                        <h2 id={titleId} className="ask-reader-title">
                            {source.headline || "Untitled"}
                        </h2>

                        {source.byline ? (
                            <p className="ask-reader-byline">{source.byline}</p>
                        ) : null}

                        {source.imageUrls.length > 0 ? (
                            <SourcePhotosStrip
                                urls={source.imageUrls}
                                captions={source.imageCaptions}
                                alt={source.headline || "Source photo"}
                            />
                        ) : null}

                        <div className="ask-reader-body" aria-busy={loading}>
                            {loading ? (
                                <p className="ask-reader-status" role="status" aria-live="polite">Loading…</p>
                            ) : error ? (
                                <p className="ask-reader-status" role="alert">{error}</p>
                            ) : paragraphs.length > 0 ? (
                                paragraphs.map((p, i) => <p key={i}>{p}</p>)
                            ) : (
                                <p className="ask-reader-status">
                                    No full text available for this article.
                                </p>
                            )}
                        </div>

                        <div className="ask-reader-footer">
                            <Link
                                className="ask-reader-edition-link"
                                href={`/edition/${source.editionDate}`}
                                onClick={(e) => {
                                    if (
                                        e.button === 0 &&
                                        !e.metaKey &&
                                        !e.ctrlKey &&
                                        !e.shiftKey &&
                                        !e.altKey
                                    ) {
                                        markExplicitEditionNavigation(source.editionDate);
                                        onClose();
                                    }
                                }}
                            >
                                Open full edition →
                            </Link>
                        </div>
                    </>
            </div>
        </div>,
        document.body,
    );
};
