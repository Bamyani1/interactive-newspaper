"use client";

import React, { useRef, useEffect } from "react";
import { PageShell } from "@/shared";
import { TimeControls } from "@/features/time-controls";
import { SiteFooter } from "@/features/footer";
import { AskInput, AnswerPanel, SourceList, AskEmptyState, TimelineGallery, useAskArchive } from "@/features/ask-archive";

const STAGE_LABELS: Record<string, string> = {
  reformulate: "Understanding the question…",
  embed: "Encoding the query…",
  retrieve: "Searching the archive…",
  rerank: "Ranking articles by relevance…",
  generate: "Writing the answer…",
};

export default function AskPage() {
  const { answer, isStreaming, stage, isLoading, error, submit, reset } = useAskArchive();
  const answerRef = useRef<HTMLDivElement>(null);

  // Focus the answer container when the first non-null answer appears so
  // screen readers jump to the content.
  useEffect(() => {
    if (answer && !isStreaming) {
      answerRef.current?.focus();
    }
  }, [answer, isStreaming]);

  // Pre-generation loading shows a stage label instead of a blank skeleton.
  // Once metadata arrives, `answer` is populated (even though the `answer.answer`
  // text is empty/growing) and we render the progressive AnswerPanel + SourceList.
  const showPreGenLoading = isLoading && !answer && !error;
  const stageLabel = stage ? STAGE_LABELS[stage] ?? "Searching the archive…" : null;

  return (
    <PageShell variant="default" hasHeader>
      <TimeControls />
      <main className="w-full flex-1">
        <div className="ask-container">
          {!answer && !isLoading && !error && <AskEmptyState />}
          {(answer || isLoading || error) && (
            <h1 className="sr-only">Ask the Archive</h1>
          )}

          <AskInput onSubmit={submit} isLoading={isLoading} />

          <div aria-live="polite" aria-atomic="false">
            {showPreGenLoading && (
              <div className="ask-loading-skeleton mt-8" role="status">
                <span className="sr-only">{stageLabel ?? "Searching the archive..."}</span>
                {stageLabel && (
                  <p
                    className="text-sm mb-3"
                    style={{ color: "var(--color-text-secondary)" }}
                  >
                    {stageLabel}
                  </p>
                )}
                <div className="ask-loading-bar ask-loading-bar--long" />
                <div className="ask-loading-bar ask-loading-bar--medium" />
                <div className="ask-loading-bar ask-loading-bar--short" />
                <div className="ask-loading-bar ask-loading-bar--long" />
                <div className="ask-loading-bar ask-loading-bar--medium" />
              </div>
            )}

            {error && (
              <div className="mt-8 p-4 rounded-sm" style={{
                border: "1px solid var(--color-accent)",
                background: "var(--color-bg-secondary)",
              }}>
                <p className="text-sm" style={{ color: "var(--color-accent)" }}>
                  {error}
                </p>
                <button
                  onClick={reset}
                  className="text-xs mt-2 underline opacity-70 hover:opacity-100 transition-opacity"
                  style={{ color: "var(--color-text-primary)" }}
                >
                  Try again
                </button>
              </div>
            )}

            {answer && (
              <div
                ref={answerRef}
                tabIndex={-1}
                className={`outline-none ${isStreaming ? "" : "ask-answer-enter"}`}
              >
                {answer.mode === "visual" && !isStreaming && (
                  <TimelineGallery response={answer} />
                )}
                <AnswerPanel response={answer} isStreaming={isStreaming} />
                <SourceList sources={answer.sourceArticles} />
              </div>
            )}
          </div>
        </div>
      </main>
      <SiteFooter />
    </PageShell>
  );
}
