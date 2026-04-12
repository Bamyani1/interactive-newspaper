"use client";

import React from "react";
import type { AskResponse } from "@/src/types";
import { ConfidenceBadge } from "./ConfidenceBadge";

interface AnswerPanelProps {
  response: AskResponse;
}

/**
 * Renders a plain text segment with **bold** and *italic* formatting.
 */
function renderFormattedText(text: string, keyPrefix: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((part, i) => {
    const boldMatch = part.match(/^\*\*([^*]+)\*\*$/);
    if (boldMatch) {
      return <strong key={`${keyPrefix}-f${i}`}>{boldMatch[1]}</strong>;
    }
    const italicMatch = part.match(/^\*([^*]+)\*$/);
    if (italicMatch) {
      return <em key={`${keyPrefix}-f${i}`}>{italicMatch[1]}</em>;
    }
    return part ? <span key={`${keyPrefix}-f${i}`}>{part}</span> : null;
  });
}

/**
 * Renders an inline segment (not a header) by splitting on [Source N]
 * markers and turning them into clickable links, with bold/italic support.
 */
function renderInlineWithCitations(text: string, keyOffset: number): React.ReactNode[] {
  const parts = text.split(/(\[Source \d+\])/g);
  return parts.map((part, i) => {
    const match = part.match(/^\[Source (\d+)\]$/);
    if (match) {
      const num = match[1];
      return (
        <a
          key={`${keyOffset}-${i}`}
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
    return <React.Fragment key={`${keyOffset}-${i}`}>{renderFormattedText(part, `${keyOffset}-${i}`)}</React.Fragment>;
  });
}

/**
 * Parses answer text into structured blocks: ## headers become <h3>,
 * double-newlines become paragraph breaks, and [Source N] becomes links.
 */
function renderAnswerWithCitations(text: string): React.ReactNode[] {
  const lines = text.split("\n");
  const blocks: React.ReactNode[] = [];
  let currentParagraph: string[] = [];
  let blockIndex = 0;

  const flushParagraph = () => {
    const content = currentParagraph.join(" ").trim();
    if (content) {
      blocks.push(<p key={`p-${blockIndex}`}>{renderInlineWithCitations(content, blockIndex)}</p>);
      blockIndex++;
    }
    currentParagraph = [];
  };

  for (const line of lines) {
    const headerMatch = line.match(/^##\s+(.+)$/);
    if (headerMatch) {
      flushParagraph();
      blocks.push(
        <h3 key={`h-${blockIndex}`} className="ask-answer-heading">
          {headerMatch[1]}
        </h3>
      );
      blockIndex++;
    } else if (line.trim() === "") {
      flushParagraph();
    } else {
      currentParagraph.push(line);
    }
  }
  flushParagraph();

  return blocks;
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
