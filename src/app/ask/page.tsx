"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { PageShell } from "@/shared";
import { TimeControls } from "@/features/time-controls";
import { SiteFooter } from "@/features/footer";
import {
  AskInput,
  AnswerPanel,
  SourceList,
  TimelineGallery,
  ResearchFeed,
  ResearchSummary,
  LowConfidenceCaveat,
  FollowUpQuestions,
  ConversationHistory,
  useAskArchive,
} from "@/features/ask-archive";
import { FeedbackButtons } from "@/features/ask-archive/components/FeedbackButtons";

export default function AskPage() {
  const {
    answer,
    isStreaming,
    isLoading,
    error,
    feedEntries,
    submit,
    reset,
    newConversation,
    sessionGen,
  } = useAskArchive();

  // Input value is owned at the page level so history-click handlers
  // can populate it without triggering a submit.
  const [inputValue, setInputValue] = useState("");
  const [focusSignal, setFocusSignal] = useState(0);

  const answerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (answer && !isStreaming) {
      answerRef.current?.focus();
    }
  }, [answer, isStreaming]);

  const feedActive = isLoading || isStreaming;
  const hasAnswerText = answer ? answer.answer.trim().length > 0 : false;

  const handleSubmit = useCallback(
    (question: string) => {
      submit(question);
      // Clear the input box so the next question starts on a clean slate.
      setInputValue("");
    },
    [submit],
  );

  const handleNewConversation = useCallback(() => {
    newConversation();
    setInputValue("");
  }, [newConversation]);

  const handlePickHistory = useCallback((question: string) => {
    setInputValue(question);
    // Bump focus signal so AskInput refocuses + selects the populated text.
    setFocusSignal((n) => n + 1);
  }, []);

  return (
    <PageShell variant="default" hasHeader>
      <TimeControls />
      <main className="w-full flex-1">
        <div className="max-w-3xl mx-auto px-6 py-10">
          <div className="flex items-center justify-between mb-3">
            <p
              className="text-xs uppercase tracking-widest"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Ask
            </p>
            {answer && !isStreaming && (
              <button
                type="button"
                onClick={handleNewConversation}
                className="ask-newconv-btn"
                aria-label="Start a new conversation"
                title="Clears the current question and conversation history"
              >
                <RotateCcw size={12} aria-hidden="true" />
                <span>New conversation</span>
              </button>
            )}
          </div>
          <h1 className="font-header text-3xl mb-6">Ask the Archive</h1>

          <ConversationHistory
            onPickQuestion={handlePickHistory}
            disabled={isLoading}
            refreshKey={answer?.requestId}
            sessionGen={sessionGen}
          />

          <div className="flex flex-col gap-4 mb-8">
            <AskInput
              value={inputValue}
              onChange={setInputValue}
              onSubmit={handleSubmit}
              isLoading={isLoading}
              focusSignal={focusSignal}
            />
          </div>

          <div aria-live="polite" aria-atomic="false">
            <ResearchFeed entries={feedEntries} isActive={feedActive} />

            {error && (
              <div
                className="mt-8 p-4 rounded-sm"
                style={{
                  border: "1px solid var(--color-accent)",
                  background: "var(--color-bg-secondary)",
                }}
              >
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
                {!isStreaming && (
                  <LowConfidenceCaveat confidence={answer.confidence} />
                )}
                {(hasAnswerText || !isStreaming) && (
                  <AnswerPanel response={answer} isStreaming={isStreaming} />
                )}
                {!isStreaming && (
                  <>
                    <ResearchSummary response={answer} />
                    <FeedbackButtons response={answer} />
                    <FollowUpQuestions
                      questions={answer.followUpQuestions ?? []}
                      onSelect={handleSubmit}
                      disabled={isLoading}
                    />
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
