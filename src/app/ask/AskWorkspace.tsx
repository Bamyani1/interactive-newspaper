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

function DeepLinkBridge({
    isHydrating,
    turnCount,
    submit,
}: {
    isHydrating: boolean;
    turnCount: number;
    submit: (question: string) => void;
}) {
    useDeepLinkSubmit({ isHydrating, turnCount, submit });
    return null;
}

interface AskWorkspaceProps {
    /** Request-time UTC date shared by SSR and hydration for daily prompts. */
    suggestionDate?: string;
}

export default function AskWorkspace({
    suggestionDate = "2000-01-01",
}: AskWorkspaceProps) {
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
        clearConversation,
        newConversation,
        switchThread,
    } = useAskArchive();

    const [isExporting, setIsExporting] = useState(false);
    const lastTurn = turns[turns.length - 1];
    const isStreaming = lastTurn?.status === "streaming";
    const focusSignal = `${sessionGen}:${
        lastTurn?.status === "done" || lastTurn?.status === "error"
            ? `${lastTurn.id}:${lastTurn.status}`
            : "idle"
    }`;

    const canStartConversation =
        !isHydrating &&
        (turns.length > 0 || sessionGen > 0 || threads.length > 0);
    const canMutateConversation =
        !isHydrating && turns.length > 0 && !isStreaming;
    const canExportConversation = canMutateConversation && !isExporting;

    const handleFollowUp = useCallback(
        (question: string) => {
            submit(question);
        },
        [submit],
    );

    const handleExport = useCallback(async () => {
        if (turns.length === 0 || isExporting) return;

        setIsExporting(true);
        try {
            const { exportConversationPdf } = await import(
                "@/features/ask-archive/lib/export-conversation-pdf"
            );
            await exportConversationPdf(turns);
        } catch (error) {
            console.error("Failed to export conversation PDF", error);
        } finally {
            setIsExporting(false);
        }
    }, [isExporting, turns]);

    return (
        <PageShell variant="default" hasHeader>
            <Suspense fallback={null}>
                <DeepLinkBridge
                    isHydrating={isHydrating}
                    turnCount={turns.length}
                    submit={submit}
                />
            </Suspense>
            <TimeControls />
            <main id="main-content" tabIndex={-1} className="ask-main">
                <div className="ask-page">
                    <AskSidebar
                        threads={threads}
                        activeThreadId={activeThreadId}
                        onNewConversation={newConversation}
                        onClearConversation={clearConversation}
                        onExportConversation={handleExport}
                        onSwitchThread={switchThread}
                        canNewConversation={canStartConversation}
                        canClearConversation={canMutateConversation}
                        canExportConversation={canExportConversation}
                    />

                    <div className="ask-column">
                        <AskMobileActions
                            onNewConversation={newConversation}
                            onClearConversation={clearConversation}
                            onExportConversation={handleExport}
                            canNewConversation={canStartConversation}
                            canClearConversation={canMutateConversation}
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
        </PageShell>
    );
}
