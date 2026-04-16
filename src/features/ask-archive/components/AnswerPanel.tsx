"use client";

import React from "react";
import type { AskResponse } from "@/src/types";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { FeedbackButtons } from "./FeedbackButtons";

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
 * Parses answer text into structured blocks: ## headers become <h3>,
 * double-newlines become paragraph breaks, and citations become links.
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

      {!isStreaming && (
        <>
          <div className="ask-meta mt-4">
            <ConfidenceBadge confidence={response.confidence} />
            <span>{response.meta.articlesSearched} articles searched</span>
            <span>{(response.meta.totalTimeMs / 1000).toFixed(1)}s</span>
          </div>
          <FeedbackButtons response={response} />
        </>
      )}
    </div>
  );
};
