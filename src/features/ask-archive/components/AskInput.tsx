"use client";

import React, { useRef, useEffect } from "react";
import { MessageCircleQuestion, Send } from "lucide-react";

interface AskInputProps {
  /** Controlled value — owned by the page so history-click can set it. */
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  isLoading: boolean;
  /**
   * Monotonic counter. When it changes, the input re-focuses and
   * selects its current text so the user can immediately edit a
   * question populated by clicking a history item.
   */
  focusSignal?: number;
}

const EXAMPLE_QUESTIONS = [
  "How did campus life change from the 1950s to the 2000s?",
  "Tell me about OWU sports teams",
  "What were students protesting?",
  "What plays were performed on campus?",
];

export const AskInput: React.FC<AskInputProps> = ({
  value,
  onChange,
  onSubmit,
  isLoading,
  focusSignal,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    // Re-focus + select when the caller bumps focusSignal (e.g. after
    // picking a question from history).
    if (focusSignal === undefined) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusSignal]);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed || isLoading) return;
    onSubmit(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleExampleClick = (question: string) => {
    onChange(question);
    inputRef.current?.focus();
    onSubmit(question);
  };

  return (
    <div>
      <div className="relative flex items-center">
        <MessageCircleQuestion
          className="absolute left-4 opacity-50"
          size={20}
          style={{ color: "var(--color-text-primary)" }}
        />
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask a question about OWU history..."
          aria-label="Ask the archive a question"
          className="w-full py-3 pl-12 pr-12 text-lg outline-none transition-colors focus-visible:ring-2"
          style={{
            backgroundColor: "var(--color-bg-secondary)",
            color: "var(--color-text-primary)",
            borderRadius: "4px",
            border: "1px solid var(--color-border-default)",
            fontFamily: "var(--font-body)",
          }}
        />
        <button
          className="absolute right-3 transition-opacity"
          onClick={handleSubmit}
          disabled={!value.trim() || isLoading}
          aria-label="Submit question"
          style={{
            color: !value.trim() || isLoading
              ? "var(--color-text-secondary)"
              : "var(--color-accent)",
            opacity: !value.trim() || isLoading ? 0.4 : 1,
            cursor: !value.trim() || isLoading ? "not-allowed" : "pointer",
          }}
        >
          {isLoading ? (
            <div
              className="h-4 w-4 animate-spin rounded-full border-2 border-t-transparent"
              style={{ borderColor: "var(--color-accent)", borderTopColor: "transparent" }}
            />
          ) : (
            <Send size={18} />
          )}
        </button>
      </div>

      <div className="ask-examples">
        {EXAMPLE_QUESTIONS.map((q) => (
          <button
            key={q}
            className="ask-example-chip"
            onClick={() => handleExampleClick(q)}
            disabled={isLoading}
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
};
