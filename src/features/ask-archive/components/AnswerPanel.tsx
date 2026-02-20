"use client";

import React from "react";
import type { AskResponse } from "@/src/types";
import { ConfidenceBadge } from "./ConfidenceBadge";

interface AnswerPanelProps {
  response: AskResponse;
}

/**
 * Splits answer text on [Source N] markers, rendering them as clickable
 * links that scroll to the corresponding SourceCard.
 */
function renderAnswerWithCitations(text: string): React.ReactNode[] {
  const parts = text.split(/(\[Source \d+\])/g);
  return parts.map((part, i) => {
    const match = part.match(/^\[Source (\d+)\]$/);
    if (match) {
      const num = match[1];
      return (
        <a
          key={i}
          className="ask-citation-link"
          href={`#ask-source-${num}`}
          onClick={(e) => {
            e.preventDefault();
            document.getElementById(`ask-source-${num}`)?.scrollIntoView({
              behavior: "smooth",
              block: "center",
            });
          }}
        >
          [{num}]
        </a>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

export const AnswerPanel: React.FC<AnswerPanelProps> = ({ response }) => {
  return (
    <div className="mt-8">
      <div className="ask-answer">
        {renderAnswerWithCitations(response.answer)}
      </div>

      <div className="ask-meta mt-4">
        <ConfidenceBadge confidence={response.confidence} />
        <span>{response.meta.articlesSearched} articles searched</span>
        <span>{(response.meta.totalTimeMs / 1000).toFixed(1)}s</span>
      </div>
    </div>
  );
};
