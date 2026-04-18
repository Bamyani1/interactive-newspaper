"use client";

import React, { useEffect, useRef } from "react";
import type { Turn as TurnData } from "../hooks/askReducer";
import { Turn } from "./Turn";

interface TranscriptProps {
    turns: TurnData[];
    isHydrating: boolean;
    expiredBanner: boolean;
    onFollowUp: (question: string) => void;
    onRetry: (turnId: string) => void;
}

export const Transcript: React.FC<TranscriptProps> = ({
    turns,
    isHydrating,
    expiredBanner,
    onFollowUp,
    onRetry,
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const prevTurnCountRef = useRef(turns.length);

    // When a new turn is added, anchor the viewport to the top of that
    // turn so the reader starts at the beginning of the answer. During
    // streaming (same turn, growing answer), leave the scroll alone so
    // the reader isn't yanked down.
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const isNewTurn = turns.length > prevTurnCountRef.current;
        prevTurnCountRef.current = turns.length;
        if (!isNewTurn) return;
        const lastTurn = el.querySelector(
            ".ask-turn:last-of-type",
        ) as HTMLElement | null;
        if (!lastTurn) return;
        const turnTop = lastTurn.getBoundingClientRect().top;
        const containerTop = el.getBoundingClientRect().top;
        el.scrollTop += turnTop - containerTop;
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
                    <span className="ask-expired-banner-label">Notice</span>
                    <span> — Your last conversation expired. Starting fresh.</span>
                </div>
            ) : null}

            {isHydrating && isEmpty ? (
                <p
                    className="ask-hydrating-indicator"
                    role="status"
                    aria-live="polite"
                >
                    Restoring conversation…
                </p>
            ) : null}

            {turns.map((turn, i) => (
                <Turn
                    key={turn.id}
                    turn={turn}
                    isLatest={i === turns.length - 1}
                    onFollowUp={onFollowUp}
                    onRetry={onRetry}
                />
            ))}
        </div>
    );
};
