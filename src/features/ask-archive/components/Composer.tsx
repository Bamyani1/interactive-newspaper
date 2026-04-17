"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, RotateCcw } from "lucide-react";

interface ComposerProps {
    disabled?: boolean;
    onSubmit: (question: string) => void;
    onNewConversation: () => void;
    /**
     * Bump to request a focus+clear of the composer (used after a turn
     * completes so the user can type the next question immediately).
     */
    focusSignal?: number;
    /** Hide the "New conversation" button when there's nothing to clear. */
    canStartNewConversation?: boolean;
}

const MAX_ROWS = 8;

export const Composer: React.FC<ComposerProps> = ({
    disabled,
    onSubmit,
    onNewConversation,
    focusSignal,
    canStartNewConversation = false,
}) => {
    const [value, setValue] = useState("");
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Auto-resize the textarea up to MAX_ROWS lines.
    const resize = useCallback(() => {
        const el = textareaRef.current;
        if (!el) return;
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
            {canStartNewConversation ? (
                <button
                    type="button"
                    onClick={onNewConversation}
                    className="ask-newconv-btn"
                    aria-label="Start a new conversation"
                    title="Clears the current conversation"
                >
                    <RotateCcw size={12} aria-hidden="true" />
                    <span>New conversation</span>
                </button>
            ) : null}
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
                    <ArrowRight size={16} aria-hidden="true" />
                </button>
            </form>
        </div>
    );
};
