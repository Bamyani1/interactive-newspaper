"use client";

import React, { useCallback, useEffect, useState } from "react";
import { PageShell } from "@/shared";
import { TimeControls } from "@/features/time-controls";
import { useAskArchive } from "@/features/ask-archive/hooks/useAskArchive";
import { Transcript } from "@/features/ask-archive/components/Transcript";
import { Composer } from "@/features/ask-archive/components/Composer";
import { AskSidebar } from "@/features/ask-archive/components/AskSidebar";

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
            <main className="ask-main">
                <div className="ask-page">
                    <AskSidebar
                        turns={turns}
                        onNewConversation={newConversation}
                        canStartNewConversation={turns.length > 0}
                    />

                    <div className="ask-column">
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
                            focusSignal={focusSignal}
                        />
                    </div>
                </div>
            </main>
        </PageShell>
    );
}
