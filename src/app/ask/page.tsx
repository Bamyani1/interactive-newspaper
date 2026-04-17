"use client";

import React, { useCallback, useEffect, useState } from "react";
import { PageShell } from "@/shared";
import { TimeControls } from "@/features/time-controls";
import { SiteFooter } from "@/features/footer";
import { useAskArchive } from "@/features/ask-archive/hooks/useAskArchive";
import { Transcript } from "@/features/ask-archive/components/Transcript";
import { Composer } from "@/features/ask-archive/components/Composer";

export default function AskPage() {
    const {
        turns,
        isHydrating,
        expiredBanner,
        submit,
        retry,
        newConversation,
    } = useAskArchive();

    const [focusSignal, setFocusSignal] = useState(0);

    const lastTurn = turns[turns.length - 1];
    const isStreaming = lastTurn?.status === "streaming";

    // Refocus the composer after each turn completes so the user can
    // type the next question immediately.
    useEffect(() => {
        if (!lastTurn) return;
        if (lastTurn.status === "done" || lastTurn.status === "error") {
            setFocusSignal((n) => n + 1);
        }
    }, [lastTurn?.status, lastTurn]);

    const handleFollowUp = useCallback(
        (question: string) => {
            submit(question);
        },
        [submit],
    );

    const handleExample = useCallback(
        (question: string) => {
            submit(question);
        },
        [submit],
    );

    return (
        <PageShell variant="default" hasHeader>
            <TimeControls />
            <main className="w-full flex-1">
                <div className="ask-page">
                    <div className="ask-page-inner">
                        <header className="ask-page-header">
                            <p className="ask-page-eyebrow">Ask</p>
                            <h1 className="ask-page-title">Ask the Archive</h1>
                        </header>

                        <Transcript
                            turns={turns}
                            isHydrating={isHydrating}
                            expiredBanner={expiredBanner}
                            onFollowUp={handleFollowUp}
                            onExampleQuestion={handleExample}
                            onRetry={retry}
                        />

                        <Composer
                            disabled={isStreaming}
                            onSubmit={submit}
                            onNewConversation={newConversation}
                            focusSignal={focusSignal}
                            canStartNewConversation={turns.length > 0}
                        />
                    </div>
                </div>
            </main>
            <SiteFooter />
        </PageShell>
    );
}
