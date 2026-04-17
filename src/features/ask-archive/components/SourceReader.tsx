"use client";

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import type { AskResponse } from "@/src/types";

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
    const router = useRouter();
    const [mounted, setMounted] = useState(false);
    const [article, setArticle] = useState<EditionArticle | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const cacheRef = useRef<Map<string, EditionArticle[]>>(new Map());
    // Track whether we've pushed a history sentinel for the currently
    // open drawer. Used so browser-back closes the drawer instead of
    // leaving /ask, and so clicking close doesn't leave an orphan entry.
    const historyPushedRef = useRef(false);

    useEffect(() => {
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
            .catch((err: Error) => {
                if (!cancelled) {
                    setError(err.message || "Failed to load article.");
                }
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [source]);

    // Escape to close; lock body scroll while open.
    useEffect(() => {
        if (!source) return undefined;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        document.addEventListener("keydown", onKey);
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            document.removeEventListener("keydown", onKey);
            document.body.style.overflow = prevOverflow;
        };
    }, [source, onClose]);

    // History integration: push a sentinel state when the drawer opens so
    // browser-back closes the drawer instead of navigating away from
    // /ask. When the drawer is closed by user action (close button /
    // Escape / overlay click) rewind the pushed entry so nothing
    // orphaned remains in the back stack.
    useEffect(() => {
        if (typeof window === "undefined") return undefined;
        if (!source) {
            if (
                historyPushedRef.current &&
                (window.history.state as { askReader?: boolean } | null)
                    ?.askReader
            ) {
                historyPushedRef.current = false;
                window.history.back();
            } else {
                historyPushedRef.current = false;
            }
            return undefined;
        }
        if (!historyPushedRef.current) {
            window.history.pushState({ askReader: true }, "");
            historyPushedRef.current = true;
        }
        const onPopState = () => {
            // User hit browser back — the sentinel entry has already been
            // consumed, so don't try to rewind it again on close.
            historyPushedRef.current = false;
            onClose();
        };
        window.addEventListener("popstate", onPopState);
        return () => window.removeEventListener("popstate", onPopState);
    }, [source, onClose]);

    if (!mounted) return null;

    const paragraphs = paragraphsFrom(article?.fullText);

    return createPortal(
        <div
            className="ask-reader-overlay"
            data-open={source !== null}
            onClick={onClose}
            role="dialog"
            aria-modal="true"
            aria-label={source?.headline ?? "Article reader"}
        >
            <div
                className="ask-reader"
                onClick={(e) => e.stopPropagation()}
            >
                <button
                    type="button"
                    className="ask-reader-close"
                    onClick={onClose}
                    aria-label="Close article reader"
                >
                    Close ✕
                </button>

                {source ? (
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

                        <h2 className="ask-reader-title">
                            {source.headline || "Untitled"}
                        </h2>

                        {source.byline ? (
                            <p className="ask-reader-byline">{source.byline}</p>
                        ) : null}

                        <div className="ask-reader-body">
                            {loading ? (
                                <p className="ask-reader-status">Loading…</p>
                            ) : error ? (
                                <p className="ask-reader-status">{error}</p>
                            ) : paragraphs.length > 0 ? (
                                paragraphs.map((p, i) => <p key={i}>{p}</p>)
                            ) : (
                                <p className="ask-reader-status">
                                    No full text available for this article.
                                </p>
                            )}
                        </div>

                        <div className="ask-reader-footer">
                            <a
                                className="ask-reader-edition-link"
                                href={`/edition/${source.editionDate}`}
                                onClick={(e) => {
                                    // Route via Next.js client-side
                                    // navigation so /ask stays in the
                                    // App Router cache. Hard nav via
                                    // plain <a> dropped the page from
                                    // the cache, so browser-back
                                    // landed on a fresh SSR shell
                                    // (empty transcript) instead of
                                    // the live conversation. Strip
                                    // the askReader sentinel first so
                                    // the cached /ask entry doesn't
                                    // carry the drawer-open bit.
                                    e.preventDefault();
                                    const current =
                                        (window.history.state as
                                            | ({ askReader?: boolean } & Record<
                                                  string,
                                                  unknown
                                              >)
                                            | null) ?? null;
                                    if (
                                        historyPushedRef.current &&
                                        current?.askReader
                                    ) {
                                        historyPushedRef.current = false;
                                        const { askReader: _askReader, ...rest } =
                                            current;
                                        void _askReader;
                                        window.history.replaceState(
                                            rest,
                                            "",
                                            window.location.href,
                                        );
                                    }
                                    router.push(`/edition/${source.editionDate}`);
                                }}
                            >
                                Open full edition →
                            </a>
                        </div>
                    </>
                ) : null}
            </div>
        </div>,
        document.body,
    );
};
