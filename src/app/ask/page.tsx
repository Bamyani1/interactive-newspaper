"use client";

import React, { useRef, useEffect } from "react";
import { PageShell } from "@/shared";
import { TimeControls } from "@/features/time-controls";
import { SiteFooter } from "@/features/footer";
import { AskInput, AnswerPanel, SourceList, AskEmptyState, TimelineGallery, useAskArchive } from "@/features/ask-archive";

export default function AskPage() {
  const { answer, isLoading, error, submit, reset } = useAskArchive();
  const answerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (answer) {
      answerRef.current?.focus();
    }
  }, [answer]);

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
            {isLoading && (
              <div className="ask-loading-skeleton mt-8" role="status">
                <span className="sr-only">Searching the archive...</span>
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
              <div ref={answerRef} tabIndex={-1} className="outline-none ask-answer-enter">
                {answer.mode === "visual" ? (
                  <TimelineGallery response={answer} />
                ) : (
                  <>
                    <AnswerPanel response={answer} />
                    <SourceList sources={answer.sourceArticles} />
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </main>
      <SiteFooter />
    </PageShell>
  );
}
