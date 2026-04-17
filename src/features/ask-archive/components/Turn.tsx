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

export const Turn: React.FC<TurnProps> = ({ turn, onFollowUp, onRetry }) => {
    const articleIdIndex = useMemo(
        () => buildArticleIdIndex(turn.sourceArticles),
        [turn.sourceArticles],
    );

    const isStreaming = turn.status === "streaming";
    const hasText = turn.answer.trim().length > 0;
    const showStagePill = isStreaming && !hasText;

    return (
        <article className="ask-turn">
            <div
                className="ask-turn-user"
                aria-label="Your question"
            >
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
                            <div className="ask-thinking-pill">
                                <span className="ask-thinking-dot" />
                                <span>{turn.stage ?? "Thinking…"}</span>
                            </div>
                        ) : null}

                        {hasText ? (
                            <div className="ask-turn-answer">
                                <Markdown articleIdIndex={articleIdIndex}>
                                    {turn.answer}
                                </Markdown>
                                {isStreaming ? (
                                    <span
                                        className="ask-cursor"
                                        aria-hidden="true"
                                    >
                                        ▊
                                    </span>
                                ) : null}
                            </div>
                        ) : null}

                        {!isStreaming && turn.status === "done" ? (
                            <>
                                <LowConfidenceCaveat
                                    confidence={turn.confidence}
                                />
                                <SourceList sources={turn.sourceArticles} />
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
