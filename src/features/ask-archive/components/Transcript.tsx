"use client";

import React, { useEffect, useRef } from "react";
import type { Turn as TurnData } from "../hooks/askReducer";
import { Turn } from "./Turn";
import { AskEmptyState } from "./AskEmptyState";

interface TranscriptProps {
    turns: TurnData[];
    isHydrating: boolean;
    expiredBanner: boolean;
    onFollowUp: (question: string) => void;
    onExampleQuestion: (question: string) => void;
    onRetry: (turnId: string) => void;
}

const STICKY_SCROLL_THRESHOLD = 120;

export const Transcript: React.FC<TranscriptProps> = ({
    turns,
    isHydrating,
    expiredBanner,
    onFollowUp,
    onExampleQuestion,
    onRetry,
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const wasNearBottomRef = useRef(true);

    // Track whether the user is near the bottom BEFORE the transcript
    // grows, so we only auto-scroll when they were already following
    // along. If they've scrolled up to re-read a prior turn, we
    // don't hijack the scroll position.
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const handler = () => {
            const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
            wasNearBottomRef.current = distance < STICKY_SCROLL_THRESHOLD;
        };
        el.addEventListener("scroll", handler, { passive: true });
        return () => el.removeEventListener("scroll", handler);
    }, []);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        if (wasNearBottomRef.current) {
            el.scrollTop = el.scrollHeight;
        }
    }, [turns]);

    const isEmpty = turns.length === 0;

    return (
        <div
            ref={containerRef}
            className="ask-transcript"
            role="log"
            aria-label="Conversation transcript"
            aria-busy={isHydrating}
        >
            {expiredBanner ? (
                <div className="ask-expired-banner" role="status">
                    Your last conversation expired. Starting fresh.
                </div>
            ) : null}

            {isEmpty && !isHydrating ? (
                <AskEmptyState onPickExample={onExampleQuestion} />
            ) : null}

            {turns.map((turn) => (
                <Turn
                    key={turn.id}
                    turn={turn}
                    onFollowUp={onFollowUp}
                    onRetry={onRetry}
                />
            ))}
        </div>
    );
};
