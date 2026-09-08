"use client";

import React, { Suspense, useCallback, useState } from "react";
import { PageShell } from "@/shared";
import { TimeControls } from "@/features/time-controls";
import { useAskArchive } from "@/features/ask-archive/hooks/useAskArchive";
import { useDeepLinkSubmit } from "@/features/ask-archive/hooks/useDeepLinkSubmit";
import { Transcript } from "@/features/ask-archive/components/Transcript";
import { Composer } from "@/features/ask-archive/components/Composer";
import { AskSidebar } from "@/features/ask-archive/components/AskSidebar";
import { AskMobileActions } from "@/features/ask-archive/components/AskMobileActions";
import { ClearThreadsDialog } from "@/features/ask-archive/components/ClearThreadsDialog";

function DeepLinkBridge({
  isHydrating,
  turnCount,
  submit,
  startNewConversation,
}: {
  isHydrating: boolean;
  turnCount: number;
  submit: (question: string) => void;
  startNewConversation: () => void;
}) {
  useDeepLinkSubmit({ isHydrating, turnCount, submit, startNewConversation });
  return null;
}

interface AskWorkspaceProps {
  /** Request-time UTC date shared by SSR and hydration for daily prompts. */
  suggestionDate?: string;
}

export default function AskWorkspace({ suggestionDate = "2000-01-01" }: AskWorkspaceProps) {
  const {
    turns,
    isHydrating,
    expiredBanner,
    sessionGen,
    emptyReason,
    threads,
    activeThreadId,
    submit,
    retry,
    clearAllThreads,
    newConversation,
    switchThread,
  } = useAskArchive();

  const [isExporting, setIsExporting] = useState(false);
  const [isClearWarningOpen, setIsClearWarningOpen] = useState(false);
  const lastTurn = turns[turns.length - 1];
  const isStreaming = lastTurn?.status === "streaming";
  // `threads` only gains the current thread once it is archived, so the
  // live one is prepended for display; otherwise a user mid-first-thread
  // would see an empty sidebar and a dialog claiming nothing to clear.
  const activeThreadIsArchived = threads.some((thread) => thread.id === activeThreadId);
  const visibleThreads =
    turns.length > 0 && activeThreadId && !activeThreadIsArchived
      ? [
          {
            id: activeThreadId,
            firstQuestion: turns[0].question,
            turnCount: turns.length,
            lastUpdatedAt: lastTurn?.createdAt ?? Date.now(),
          },
          ...threads,
        ]
      : threads;
  const hasThreads = visibleThreads.length > 0 || turns.length > 0;
  const focusSignal = `${sessionGen}:${
    lastTurn?.status === "done" || lastTurn?.status === "error"
      ? `${lastTurn.id}:${lastTurn.status}`
      : "idle"
  }`;

  const canStartConversation =
    !isHydrating && (turns.length > 0 || sessionGen > 0 || threads.length > 0);
  const canMutateConversation = !isHydrating && turns.length > 0 && !isStreaming;
  // Clearing reaches the archive, so it stays available whenever any
  // thread exists — not only while the current one has turns.
  const canClearAllThreads = !isHydrating && hasThreads && !isStreaming;
  const canExportConversation = canMutateConversation && !isExporting;

  const handleFollowUp = useCallback(
    (question: string) => {
      submit(question);
    },
    [submit]
  );

  const handleExport = useCallback(async () => {
    if (turns.length === 0 || isExporting) return;

    setIsExporting(true);
    try {
      const { exportConversationPdf } =
        await import("@/features/ask-archive/lib/export-conversation-pdf");
      await exportConversationPdf(turns);
    } catch (error) {
      console.error("Failed to export conversation PDF", error);
    } finally {
      setIsExporting(false);
    }
  }, [isExporting, turns]);

  const handleConfirmClearAll = useCallback(() => {
    clearAllThreads();
    setIsClearWarningOpen(false);
  }, [clearAllThreads]);

  return (
    <PageShell variant="default" hasHeader>
      <Suspense fallback={null}>
        <DeepLinkBridge
          isHydrating={isHydrating}
          turnCount={turns.length}
          submit={submit}
          startNewConversation={newConversation}
        />
      </Suspense>
      <TimeControls />
      <main id="main-content" tabIndex={-1} className="ask-main">
        <div className="ask-page">
          <AskSidebar
            threads={visibleThreads}
            activeThreadId={activeThreadId}
            onNewConversation={newConversation}
            onClearAllThreads={() => setIsClearWarningOpen(true)}
            onExportConversation={handleExport}
            onSwitchThread={switchThread}
            canNewConversation={canStartConversation}
            canClearAllThreads={canClearAllThreads}
            canExportConversation={canExportConversation}
          />

          <div className="ask-column">
            <AskMobileActions
              onNewConversation={newConversation}
              onClearAllThreads={() => setIsClearWarningOpen(true)}
              onExportConversation={handleExport}
              canNewConversation={canStartConversation}
              canClearAllThreads={canClearAllThreads}
              canExportConversation={canExportConversation}
            />
            <Transcript
              turns={turns}
              isHydrating={isHydrating}
              expiredBanner={expiredBanner}
              emptyReason={emptyReason}
              suggestionDate={suggestionDate}
              onFollowUp={handleFollowUp}
              onRetry={retry}
            />
            <Composer
              disabled={isHydrating || isStreaming}
              onSubmit={submit}
              focusSignal={focusSignal}
            />
          </div>
        </div>
      </main>
      <ClearThreadsDialog
        isOpen={isClearWarningOpen}
        threadCount={Math.max(visibleThreads.length, 1)}
        onCancel={() => setIsClearWarningOpen(false)}
        onConfirm={handleConfirmClearAll}
      />
    </PageShell>
  );
}
