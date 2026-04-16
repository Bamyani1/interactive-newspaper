"use client";

import React from "react";

interface FollowUpQuestionsProps {
  questions: string[];
  onSelect: (question: string) => void;
  disabled?: boolean;
}

export const FollowUpQuestions: React.FC<FollowUpQuestionsProps> = ({
  questions,
  onSelect,
  disabled = false,
}) => {
  if (questions.length === 0) return null;

  return (
    <section className="ask-followups" aria-label="Suggested follow-up questions">
      <p className="ask-followups-label">Continue your research</p>
      <div className="ask-examples">
        {questions.map((q) => (
          <button
            key={q}
            type="button"
            className="ask-example-chip"
            onClick={() => onSelect(q)}
            disabled={disabled}
          >
            {q}
          </button>
        ))}
      </div>
    </section>
  );
};
