"use client";

import React, { useCallback, useMemo, useState } from "react";
import type { Turn as TurnData } from "../hooks/askReducer";
import { Markdown } from "./Markdown";
import { SourceList } from "./SourceList";
import { FollowUpQuestions } from "./FollowUpQuestions";
import { LowConfidenceCaveat } from "./LowConfidenceCaveat";
import { ErrorInline } from "./ErrorInline";
import {
    dedupSourceImages,
    extractInlineImageUrls,
    indexImagesByUrl,
} from "../lib/dedup-source-images";
import { trimIncompleteMarkdown } from "../lib/trim-incomplete-markdown";
import {
    AnswerImageContext,
    type AnswerImageContextValue,
} from "./AnswerImageContext";
import { PhotosPanel } from "./PhotosPanel";
import { Lightbox } from "@/src/components/ui/lightbox";

interface TurnProps {
    turn: TurnData;
    isLatest?: boolean;
    onFollowUp: (question: string) => void;
    onRetry: (turnId: string) => void;
    exportMode?: boolean;
}

function buildArticleIdIndex(
    sources: TurnData["sourceArticles"],
): Map<string, number> {
    const map = new Map<string, number>();
    sources.forEach((s, i) => map.set(s.id, i + 1));
    return map;
}

export const Turn: React.FC<TurnProps> = ({
    turn,
    isLatest = true,
    onFollowUp,
    onRetry,
    exportMode = false,
}) => {
    const articleIdIndex = useMemo(
        () => buildArticleIdIndex(turn.sourceArticles),
        [turn.sourceArticles],
    );

    const turnImages = useMemo(
        () => dedupSourceImages(turn.sourceArticles),
        [turn.sourceArticles],
    );
    const imageIndex = useMemo(
        () => indexImagesByUrl(turnImages),
        [turnImages],
    );

    const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

    const openLightbox = useCallback(
        (url: string) => {
            const match = imageIndex.get(url);
            if (match) setLightboxIndex(match.index);
        },
        [imageIndex],
    );

    const contextValue = useMemo<AnswerImageContextValue>(
        () => ({ metaByUrl: imageIndex, openLightbox }),
        [imageIndex, openLightbox],
    );

    const isStreaming = turn.status === "streaming";
    const hasText = turn.answer.trim().length > 0;
    const showStagePill = isStreaming && !hasText;

    // While streaming, hold back half-arrived markdown (a partial image
    // URL, a dangling "[Source", an unclosed "**") so raw syntax never
    // flashes. The reducer keeps the full text; done renders untrimmed.
    const displayAnswer = isStreaming
        ? trimIncompleteMarkdown(turn.answer)
        : turn.answer;

    // Sources arrive with the metadata event, several seconds before the
    // first answer token — show them immediately so the wait is spent
    // reading evidence, not watching dots.
    const showSources = turn.sourceArticles.length > 0;

    // Photos the LLM already embedded inline shouldn't re-appear in
    // the "More pictures" grid, otherwise the reader sees the same
    // thumbnail twice.
    const moreImages = useMemo(() => {
        const inlined = extractInlineImageUrls(turn.answer);
        if (inlined.size === 0) return turnImages;
        return turnImages.filter((img) => {
            if (inlined.has(img.src)) return false;
            try {
                if (inlined.has(decodeURI(img.src))) return false;
            } catch {
                // Malformed URL — fall through; raw compare already ran.
            }
            return true;
        });
    }, [turnImages, turn.answer]);

    const showPhotosPanel =
        turn.mode === "visual" &&
        turn.status === "done" &&
        moreImages.length > 0;

    return (
        <article
            className={`ask-turn${
                !exportMode && !isLatest ? " ask-turn--previous" : ""
            }`}
        >
            <div className="ask-turn-user" aria-label="Your question">
                <p className="ask-turn-user-label">You asked</p>
                <p className="ask-turn-user-bubble">{turn.question}</p>
            </div>

            <div
                className="ask-turn-assistant"
                aria-live="polite"
                aria-atomic="false"
            >
                {turn.status === "error" ? (
                    <ErrorInline
                        kind={turn.errorKind ?? "server"}
                        message={turn.errorMessage ?? ""}
                        retryAfterSec={turn.retryAfterSec}
                        onRetry={() => onRetry(turn.id)}
                    />
                ) : (
                    <>
                        {showStagePill ? (
                            <div
                                className="ask-thinking-rule"
                                aria-label="Thinking"
                            >
                                <span>
                                    {turn.stage ?? "Searching the archive"}
                                </span>
                                <span
                                    className="ask-thinking-dot"
                                    aria-hidden="true"
                                />
                                <span
                                    className="ask-thinking-dot"
                                    aria-hidden="true"
                                />
                                <span
                                    className="ask-thinking-dot"
                                    aria-hidden="true"
                                />
                            </div>
                        ) : null}

                        {hasText ? (
                            <>
                                <p className="ask-turn-assistant-label">
                                    The desk replies
                                </p>
                                <div
                                    className="ask-turn-answer"
                                    data-streaming={
                                        isStreaming ? "true" : undefined
                                    }
                                >
                                    <AnswerImageContext.Provider
                                        value={contextValue}
                                    >
                                        <Markdown
                                            articleIdIndex={articleIdIndex}
                                        >
                                            {displayAnswer}
                                        </Markdown>
                                    </AnswerImageContext.Provider>
                                </div>
                            </>
                        ) : null}

                        {turn.status === "done" ? (
                            <>
                                <LowConfidenceCaveat
                                    confidence={turn.confidence}
                                />
                                {showPhotosPanel ? (
                                    <PhotosPanel
                                        images={moreImages}
                                        onOpenUrl={openLightbox}
                                    />
                                ) : null}
                            </>
                        ) : null}

                        {showSources ? (
                            <SourceList
                                sources={turn.sourceArticles}
                                defaultExpanded={exportMode}
                                interactive={!exportMode}
                            />
                        ) : null}

                        {turn.status === "done" &&
                        !exportMode &&
                        turn.followUpQuestions &&
                        turn.followUpQuestions.length > 0 ? (
                            <FollowUpQuestions
                                questions={turn.followUpQuestions}
                                onSelect={onFollowUp}
                                disabled={false}
                            />
                        ) : null}
                    </>
                )}
            </div>

            {exportMode ? null : (
                <Lightbox
                    images={
                        lightboxIndex !== null
                            ? turnImages.map((img) => ({
                                  src: img.src,
                                  caption: img.caption,
                              }))
                            : []
                    }
                    initialIndex={lightboxIndex ?? 0}
                    onClose={() => setLightboxIndex(null)}
                />
            )}
        </article>
    );
};
