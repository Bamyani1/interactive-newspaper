"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";

interface ComposerProps {
    disabled?: boolean;
    onSubmit: (question: string) => void;
    /**
     * Bump to request a focus+clear of the composer (used after a turn
     * completes so the user can type the next question immediately).
     */
    focusSignal?: string | number;
}

const MAX_ROWS = 8;

export const Composer: React.FC<ComposerProps> = ({
    disabled,
    onSubmit,
    focusSignal,
}) => {
    const [value, setValue] = useState("");
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const resize = useCallback(() => {
        const el = textareaRef.current;
        if (!el) return;
        // The CSS rows/min-height contract is already the correct one-line
        // geometry. Measuring an empty textarea after mount includes its
        // padding in scrollHeight and made the composer grow by ~25px during
        // first hydration on mobile.
        if (!el.value) {
            el.style.height = "";
            el.style.overflowY = "hidden";
            return;
        }
        el.style.height = "auto";
        const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 20;
        const maxHeight = lineHeight * MAX_ROWS;
        el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
        el.style.overflowY =
            el.scrollHeight > maxHeight ? "auto" : "hidden";
    }, []);

    useEffect(() => {
        resize();
    }, [value, resize]);

    useEffect(() => {
        if (focusSignal === undefined) return;
        textareaRef.current?.focus();
    }, [focusSignal]);

    const handleSubmit = useCallback(() => {
        const trimmed = value.trim();
        if (!trimmed || disabled) return;
        onSubmit(trimmed);
        setValue("");
    }, [value, disabled, onSubmit]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
        } else if (e.key === "Escape") {
            textareaRef.current?.blur();
        }
    };

    return (
        <div className="ask-composer">
            <form
                className="ask-composer-row"
                onSubmit={(e) => {
                    e.preventDefault();
                    handleSubmit();
                }}
            >
                <textarea
                    ref={textareaRef}
                    className="ask-composer-textarea"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Ask a question about OWU history…"
                    rows={1}
                    disabled={disabled}
                    aria-label="Ask a question"
                />
                <button
                    type="submit"
                    className="ask-composer-send"
                    disabled={disabled || !value.trim()}
                    aria-label="Send question"
                >
                    <span className="ask-composer-send-label">Send</span>
                    <ArrowRight size={13} aria-hidden="true" />
                </button>
            </form>
        </div>
    );
};
