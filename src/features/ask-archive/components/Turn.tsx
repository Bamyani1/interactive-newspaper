"use client";

import React, { useMemo } from "react";
import type { Turn as TurnData } from "../hooks/askReducer";
import { Markdown } from "./Markdown";
import { SourceList } from "./SourceList";
import { FollowUpQuestions } from "./FollowUpQuestions";
import { LowConfidenceCaveat } from "./LowConfidenceCaveat";
import { ErrorInline } from "./ErrorInline";

interface TurnProps {
    turn: TurnData;
    isLatest?: boolean;
    onFollowUp: (question: string) => void;
    onRetry: (turnId: string) => void;
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
}) => {
    const articleIdIndex = useMemo(
        () => buildArticleIdIndex(turn.sourceArticles),
        [turn.sourceArticles],
    );

    const isStreaming = turn.status === "streaming";
    const hasText = turn.answer.trim().length > 0;
    const showStagePill = isStreaming && !hasText;

    return (
        <article className={`ask-turn${isLatest ? "" : " ask-turn--previous"}`}>
            <div className="ask-turn-user" aria-label="Your question">
                <p className="ask-turn-user-label">You asked</p>
                <p className="ask-turn-user-bubble">{turn.question}</p>
            </div>

            <div
                className="ask-turn-assistant"
                aria-live={isStreaming ? "polite" : undefined}
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
                                    <Markdown articleIdIndex={articleIdIndex}>
                                        {turn.answer}
                                    </Markdown>
                                </div>
                            </>
                        ) : null}

                        {!isStreaming && turn.status === "done" ? (
                            <>
                                <LowConfidenceCaveat
                                    confidence={turn.confidence}
                                />
                                <SourceList
                                    sources={turn.sourceArticles}
                                    defaultExpanded={false}
                                />
                                {turn.followUpQuestions &&
                                turn.followUpQuestions.length > 0 ? (
                                    <FollowUpQuestions
                                        questions={turn.followUpQuestions}
                                        onSelect={onFollowUp}
                                        disabled={false}
                                    />
                                ) : null}
                            </>
                        ) : null}
                    </>
                )}
            </div>
        </article>
    );
};
