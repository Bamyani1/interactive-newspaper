"use client";

import { useEffect, useRef } from "react";
import type { Article, SectionId } from "@/src/types";

interface UseKeyboardNavigationOptions {
    currentSection: SectionId;
    navArticles: Article[];
    focusedIndex: number;
    setFocusedIndex: (index: number) => void;
    setExpandedId: (updater: (prev: string | null) => string | null) => void;
    scrollIntentRef: React.MutableRefObject<{ targetId: string; block: ScrollLogicalPosition } | null>;
}

export function useKeyboardNavigation({
    currentSection,
    navArticles,
    focusedIndex,
    setFocusedIndex,
    setExpandedId,
    scrollIntentRef,
}: UseKeyboardNavigationOptions) {
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            // Don't trigger if user is typing in an input
            if (
                event.target instanceof HTMLInputElement ||
                event.target instanceof HTMLTextAreaElement
            ) {
                return;
            }

            // No keyboard navigation for Ads section
            if (currentSection === "Ads") {
                return;
            }

            switch (event.key) {
                case "j": {
                    // Next article
                    event.preventDefault();
                    const nextIndex = Math.min(focusedIndex + 1, navArticles.length - 1);
                    setFocusedIndex(nextIndex);
                    if (navArticles[nextIndex]) {
                        scrollIntentRef.current = { targetId: navArticles[nextIndex].id, block: "center" };
                    }
                    break;
                }
                case "k": {
                    // Previous article
                    event.preventDefault();
                    const prevIndex = Math.max(focusedIndex - 1, 0);
                    setFocusedIndex(prevIndex);
                    if (navArticles[prevIndex]) {
                        scrollIntentRef.current = { targetId: navArticles[prevIndex].id, block: "center" };
                    }
                    break;
                }
                case "Enter": {
                    // Expand/collapse focused article
                    event.preventDefault();
                    if (focusedIndex >= 0 && focusedIndex < navArticles.length) {
                        const article = navArticles[focusedIndex];
                        if (currentSection === "Top") {
                            scrollIntentRef.current = { targetId: "__top_expanded__", block: "start" };
                        }
                        setExpandedId((prev) =>
                            prev === article.id ? null : article.id
                        );
                    }
                    break;
                }
                case "Escape": {
                    // Collapse current article
                    event.preventDefault();
                    setExpandedId(() => null);
                    break;
                }
            }
        };

        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [currentSection, focusedIndex, navArticles, setFocusedIndex, setExpandedId, scrollIntentRef]);
}

interface UseScrollCoordinatorOptions {
    currentSection: SectionId;
    currentArticles: Article[];
    topExpandedArticle: Article | null;
    expandedId: string | null;
    scrollIntentRef: React.MutableRefObject<{ targetId: string; block: ScrollLogicalPosition } | null>;
    pendingFocusRef: React.MutableRefObject<{ id: string; category: Article["category"] } | null>;
    articleRefs: React.MutableRefObject<Map<string, HTMLElement>>;
    topExpandedRef: React.RefObject<HTMLDivElement | null>;
}

export function useScrollCoordinator({
    currentSection,
    currentArticles,
    topExpandedArticle,
    expandedId,
    scrollIntentRef,
    pendingFocusRef,
    articleRefs,
    topExpandedRef,
}: UseScrollCoordinatorOptions) {
    useEffect(() => {
        const intent = scrollIntentRef.current;
        if (!intent) return;

        // For pending focus (section switch), wait until section matches
        const pendingFocus = pendingFocusRef.current;
        if (pendingFocus && currentSection !== pendingFocus.category) return;

        scrollIntentRef.current = null;
        pendingFocusRef.current = null;

        const timer = setTimeout(() => {
            requestAnimationFrame(() => {
                // Try article refs first, then fall back to topExpandedRef
                const element =
                    articleRefs.current.get(intent.targetId) ??
                    (intent.targetId === "__top_expanded__" ? topExpandedRef.current : null);
                element?.scrollIntoView({ behavior: "smooth", block: intent.block });
            });
        }, 250);

        return () => clearTimeout(timer);
    }, [currentSection, currentArticles, topExpandedArticle, expandedId, scrollIntentRef, pendingFocusRef, articleRefs, topExpandedRef]);
}
