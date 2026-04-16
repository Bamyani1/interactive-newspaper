"use client";

import React from "react";
import type { AskResponse } from "@/src/types";

interface AnswerPanelProps {
  response: AskResponse;
  /**
   * When true, the response is still being streamed in from the server.
   * The panel renders the partial answer text but hides the confidence
   * badge + timing meta (which are only valid after the `done` event),
   * and appends a blinking cursor to signal that more text is coming.
   */
  isStreaming?: boolean;
}

type SourceArticle = AskResponse["sourceArticles"][number];

/**
 * Build a lookup from article ID (e.g. "1965-03-15-4") to 1-based source
 * index, so agent-style citations can link to the right source card.
 */
function buildArticleIdIndex(sources: SourceArticle[]): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < sources.length; i++) {
    map.set(sources[i].id, i + 1);
  }
  return map;
}

/**
 * Renders a plain text segment with **bold** and *italic* formatting.
 * The italic matcher caps spans at 80 chars and disallows newlines so
 * unbalanced asterisks from the model don't cause italic to swallow
 * whole paragraphs.
 */
function renderFormattedText(text: string, keyPrefix: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*\n]{1,80}\*)/g);
  return parts.map((part, i) => {
    const boldMatch = part.match(/^\*\*([^*]+)\*\*$/);
    if (boldMatch) {
      return <strong key={`${keyPrefix}-f${i}`}>{boldMatch[1]}</strong>;
    }
    const italicMatch = part.match(/^\*([^*\n]{1,80})\*$/);
    if (italicMatch) {
      return <em key={`${keyPrefix}-f${i}`}>{italicMatch[1]}</em>;
    }
    return part ? <span key={`${keyPrefix}-f${i}`}>{part}</span> : null;
  });
}

// Matches both [Source N] (pipeline) and [YYYY-MM-DD-N] (agent) citation formats.
const CITATION_SPLIT_RE = /(\[Source \d+\]|\[\d{4}-\d{2}-\d{2}-\d+\])/g;

/**
 * Renders an inline segment by splitting on citation markers and turning
 * them into clickable links. Supports both [Source N] and [Article ID].
 */
function renderInlineWithCitations(
  text: string,
  keyOffset: number,
  articleIdIndex: Map<string, number>,
): React.ReactNode[] {
  const parts = text.split(CITATION_SPLIT_RE);
  return parts.map((part, i) => {
    // Pipeline citation: [Source N]
    const sourceMatch = part.match(/^\[Source (\d+)\]$/);
    if (sourceMatch) {
      const num = sourceMatch[1];
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

    // Agent citation: [YYYY-MM-DD-N]
    const articleMatch = part.match(/^\[(\d{4}-\d{2}-\d{2}-\d+)\]$/);
    if (articleMatch) {
      const articleId = articleMatch[1];
      const sourceNum = articleIdIndex.get(articleId);
      if (sourceNum) {
        return (
          <a
            key={`${keyOffset}-${i}`}
            className="ask-citation-link"
            href={`#ask-source-${sourceNum}`}
            onClick={(e) => {
              e.preventDefault();
              document.getElementById(`ask-source-${sourceNum}`)?.scrollIntoView({
                behavior: "smooth",
                block: "center",
              });
            }}
          >
            [{sourceNum}]
          </a>
        );
      }
      // Article not in sourceArticles — render as plain text
      return <span key={`${keyOffset}-${i}`} className="ask-citation-unlinked">[{articleId}]</span>;
    }

    return <React.Fragment key={`${keyOffset}-${i}`}>{renderFormattedText(part, `${keyOffset}-${i}`)}</React.Fragment>;
  });
}

/**
 * Parses answer text into structured blocks: ## through ###### headers
 * become <h3>, double-newlines become paragraph breaks, lines that
 * start with `*` or `-` (bullet markers the model sometimes emits
 * despite the prompt ban) have the marker stripped, and citations
 * become links.
 */
function renderAnswerWithCitations(
  text: string,
  articleIdIndex: Map<string, number>,
): React.ReactNode[] {
  const lines = text.split("\n");
  const blocks: React.ReactNode[] = [];
  let currentParagraph: string[] = [];
  let blockIndex = 0;

  const flushParagraph = () => {
    const content = currentParagraph.join(" ").trim();
    if (content) {
      blocks.push(<p key={`p-${blockIndex}`}>{renderInlineWithCitations(content, blockIndex, articleIdIndex)}</p>);
      blockIndex++;
    }
    currentParagraph = [];
  };

  for (const rawLine of lines) {
    const headerMatch = rawLine.match(/^#{2,6}\s+(.+)$/);
    if (headerMatch) {
      flushParagraph();
      blocks.push(
        <h3 key={`h-${blockIndex}`} className="ask-answer-heading">
          {headerMatch[1]}
        </h3>
      );
      blockIndex++;
      continue;
    }
    if (rawLine.trim() === "") {
      flushParagraph();
      continue;
    }
    // Strip leading bullet markers (* or -) the model emits despite the
    // "no bullet points" rule in the system prompt. Only the line-start
    // marker is stripped; inline *italic* is untouched.
    const stripped = rawLine.replace(/^\s*[*\-]\s+/, "");
    currentParagraph.push(stripped);
  }
  flushParagraph();

  return blocks;
}

export const AnswerPanel: React.FC<AnswerPanelProps> = ({ response, isStreaming = false }) => {
  const hasAnswerText = response.answer.trim().length > 0;
  const articleIdIndex = buildArticleIdIndex(response.sourceArticles);
  return (
    <div className="mt-8">
      <div className="ask-answer">
        {hasAnswerText && renderAnswerWithCitations(response.answer, articleIdIndex)}
        {isStreaming && (
          <span
            className="ask-answer-cursor"
            aria-hidden="true"
          >
            ▊
          </span>
        )}
      </div>

    </div>
  );
};
