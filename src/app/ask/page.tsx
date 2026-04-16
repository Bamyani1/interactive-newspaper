"use client";

import React, { useRef, useEffect } from "react";
import { PageShell } from "@/shared";
import { TimeControls } from "@/features/time-controls";
import { SiteFooter } from "@/features/footer";
import { AskInput, AnswerPanel, SourceList, TimelineGallery, ResearchFeed, ResearchSummary, useAskArchive } from "@/features/ask-archive";
import { FeedbackButtons } from "@/features/ask-archive/components/FeedbackButtons";

export default function AskPage() {
  const { answer, isStreaming, isLoading, error, feedEntries, submit, reset } = useAskArchive();
  const answerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (answer && !isStreaming) {
      answerRef.current?.focus();
    }
  }, [answer, isStreaming]);

  const feedActive = isLoading || isStreaming;
  const hasAnswerText = answer ? answer.answer.trim().length > 0 : false;

  return (
    <PageShell variant="default" hasHeader>
      <TimeControls />
      <main className="w-full flex-1">
        <div className="max-w-3xl mx-auto px-6 py-10">
          <p className="text-xs uppercase tracking-widest mb-3" style={{ color: "var(--color-text-secondary)" }}>
            Ask
          </p>
          <h1 className="font-header text-3xl mb-6">Ask the Archive</h1>

          <div className="flex flex-col gap-4 mb-8">
            <AskInput onSubmit={submit} isLoading={isLoading} />
          </div>

          <div aria-live="polite" aria-atomic="false">
            <ResearchFeed entries={feedEntries} isActive={feedActive} />

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
                {(hasAnswerText || !isStreaming) && (
                  <AnswerPanel response={answer} isStreaming={isStreaming} />
                )}
                {!isStreaming && (
                  <>
                    <ResearchSummary response={answer} />
                    <FeedbackButtons response={answer} />
                  </>
                )}
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
