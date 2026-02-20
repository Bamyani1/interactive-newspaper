"use client";

import React, { useState, useRef, useEffect } from "react";
import { Send } from "lucide-react";

interface AskInputProps {
  onSubmit: (question: string) => void;
  isLoading: boolean;
}

const EXAMPLE_QUESTIONS = [
  "What was campus life like in 1960?",
  "Tell me about OWU sports teams",
  "What were students protesting?",
  "What plays were performed on campus?",
];

export const AskInput: React.FC<AskInputProps> = ({ onSubmit, isLoading }) => {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed || isLoading) return;
    onSubmit(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleExampleClick = (question: string) => {
    setValue(question);
    onSubmit(question);
  };

  return (
    <div>
      <div className="ask-input-wrapper">
        <textarea
          ref={textareaRef}
          className="ask-textarea"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask a question about OWU history..."
          rows={2}
          aria-label="Ask the archive a question"
        />
        <button
          className="ask-submit-btn"
          onClick={handleSubmit}
          disabled={!value.trim() || isLoading}
          aria-label="Submit question"
        >
          {isLoading ? (
            <div
              className="h-4 w-4 animate-spin rounded-full border-2 border-t-transparent"
              style={{ borderColor: "#fff", borderTopColor: "transparent" }}
            />
          ) : (
            <Send size={16} />
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
