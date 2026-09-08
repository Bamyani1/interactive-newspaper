"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Square } from "lucide-react";

interface ComposerProps {
  disabled?: boolean;
  /**
   * An answer is arriving. The composer stays usable — the reader can
   * draft their next question while they read — but Send becomes Stop
   * and Enter is inert, because a second submit would start another
   * pipeline server-side and cut this answer off mid-sentence.
   */
  isStreaming?: boolean;
  onSubmit: (question: string) => void;
  /** Interrupt the answer in progress, keeping the text so far. */
  onStop?: () => void;
  /**
   * Bump to request a focus+clear of the composer (used after a turn
   * completes so the user can type the next question immediately).
   */
  focusSignal?: string | number;
}

const MAX_ROWS = 8;

export const Composer: React.FC<ComposerProps> = ({
  disabled,
  isStreaming = false,
  onSubmit,
  onStop,
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
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
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
    if (!trimmed || disabled || isStreaming) return;
    onSubmit(trimmed);
    setValue("");
  }, [value, disabled, isStreaming, onSubmit]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      // Swallowed rather than passed through even while streaming: a
      // newline on Enter would be a surprise for a key that sends.
      e.preventDefault();
      handleSubmit();
    } else if (e.key === "Escape") {
      if (isStreaming) {
        e.preventDefault();
        onStop?.();
        return;
      }
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
          placeholder="Ask your own question…"
          rows={1}
          disabled={disabled}
          aria-label="Ask a question"
        />
        {isStreaming ? (
          <button
            type="button"
            className="ask-composer-send ask-composer-stop"
            onClick={onStop}
            aria-label="Stop generating"
          >
            <span className="ask-composer-send-label">Stop</span>
            <Square size={11} fill="currentColor" aria-hidden="true" />
          </button>
        ) : (
          <button
            type="submit"
            className="ask-composer-send"
            disabled={disabled || !value.trim()}
            aria-label="Send question"
          >
            <span className="ask-composer-send-label">Send</span>
            <ArrowRight size={13} aria-hidden="true" />
          </button>
        )}
      </form>
    </div>
  );
};
