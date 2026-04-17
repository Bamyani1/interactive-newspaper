"use client";

import React, { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import type { AskErrorKind } from "@/src/types";

interface ErrorInlineProps {
    kind: AskErrorKind;
    message: string;
    retryAfterSec?: number;
    onRetry: () => void;
}

function defaultMessageFor(kind: AskErrorKind, explicit?: string): string {
    if (explicit) return explicit;
    switch (kind) {
        case "rate_limit":
            return "You're asking faster than I can keep up. Try again in a moment.";
        case "budget":
            return "The archive's daily AI budget is used up. Please try again later.";
        case "timeout":
            return "That took too long. Try a more specific question, or try again.";
        case "network":
            return "Connection lost. Check your network and retry.";
        case "bad_request":
            return "I couldn't understand that question. Try rephrasing.";
        case "server":
        default:
            return "Something went wrong on my side. Please try again.";
    }
}

function labelFor(kind: AskErrorKind): string {
    switch (kind) {
        case "rate_limit":
            return "Too fast";
        case "budget":
            return "Daily budget";
        case "timeout":
            return "Timed out";
        case "network":
            return "Offline";
        case "bad_request":
            return "Couldn't parse";
        case "server":
        default:
            return "Notice";
    }
}

function formatCountdown(sec: number): string {
    if (sec <= 60) return `${sec}s`;
    if (sec < 3600) return `${Math.ceil(sec / 60)}m`;
    return `${Math.ceil(sec / 3600)}h`;
}

export const ErrorInline: React.FC<ErrorInlineProps> = ({
    kind,
    message,
    retryAfterSec,
    onRetry,
}) => {
    const [remaining, setRemaining] = useState<number | null>(
        retryAfterSec ?? null,
    );

    useEffect(() => {
        if (retryAfterSec === undefined) return undefined;
        const start = Date.now();
        const tick = () => {
            const elapsed = Math.floor((Date.now() - start) / 1000);
            setRemaining(Math.max(0, retryAfterSec - elapsed));
        };
        tick();
        const timer = window.setInterval(tick, 1000);
        return () => window.clearInterval(timer);
    }, [retryAfterSec]);

    const canRetry = remaining === null || remaining === 0;
    const displayMessage = defaultMessageFor(kind, message);

    return (
        <div className="ask-error-inline" role="alert">
            <p className="ask-error-inline-label">{labelFor(kind)}</p>
            <p className="ask-error-inline-message">{displayMessage}</p>
            {remaining !== null && remaining > 0 ? (
                <p className="ask-error-inline-countdown">
                    Retry available in {formatCountdown(remaining)}.
                </p>
            ) : null}
            <button
                type="button"
                className="ask-error-inline-retry"
                onClick={onRetry}
                disabled={!canRetry}
                aria-label="Retry this question"
            >
                <RotateCcw size={12} aria-hidden="true" />
                <span>Try again</span>
            </button>
        </div>
    );
};
