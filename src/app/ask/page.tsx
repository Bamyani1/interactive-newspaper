"use client";

import React, { useCallback, useEffect, useState } from "react";
import { PageShell } from "@/shared";
import { TimeControls } from "@/features/time-controls";
import { useAskArchive } from "@/features/ask-archive/hooks/useAskArchive";
import { useDeepLinkSubmit } from "@/features/ask-archive/hooks/useDeepLinkSubmit";
import { Transcript } from "@/features/ask-archive/components/Transcript";
import { Composer } from "@/features/ask-archive/components/Composer";
import { AskSidebar } from "@/features/ask-archive/components/AskSidebar";
import { AskLanding } from "@/features/ask-archive/components/AskLanding";

export default function AskPage() {
    const {
        turns,
        isHydrating,
        expiredBanner,
        sessionGen,
        emptyReason,
        submit,
        retry,
        clearConversation,
        newConversation,
    } = useAskArchive();

    // `/ask?q=<question>` — auto-submit once when the deep-link lands.
    useDeepLinkSubmit({
        isHydrating,
        turnCount: turns.length,
        submit,
    });

    const [focusSignal, setFocusSignal] = useState(0);

    const lastTurn = turns[turns.length - 1];
    const isStreaming = lastTurn?.status === "streaming";

    useEffect(() => {
        if (!lastTurn) return;
        if (lastTurn.status === "done" || lastTurn.status === "error") {
            setFocusSignal((n) => n + 1);
        }
    }, [lastTurn?.status, lastTurn]);

    // Auto-focus the composer after Clear Conversation so the user can
    // type the next question without a stray click. sessionGen starts
    // at 0 and increments each time the reducer handles CLEAR_CONVERSATION.
    useEffect(() => {
        if (sessionGen === 0) return;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- monotonic signal bridge: bump focusSignal once per clear so the Composer's focus-on-bump effect fires. Not an external-system sync.
        setFocusSignal((n) => n + 1);
    }, [sessionGen]);

    // Editorial AskLanding is a first-visit treatment only. Once the
    // user has either asked something (turns>0) or cleared a
    // conversation (sessionGen>0), we stay inside the chat chrome —
    // Clear should feel like "wipe the transcript, stay here," not
    // "kick me back to the landing."
    const isFirstVisit =
        turns.length === 0 && !isHydrating && sessionGen === 0;
    const showSidebar =
        turns.length > 0 || isHydrating || sessionGen > 0;

    const handleFollowUp = useCallback(
        (question: string) => {
            submit(question);
        },
        [submit],
    );

    // Export to PDF via the browser's print dialog — zero-dependency,
    // native "Save as PDF" on all platforms. Source lists are
    // conditionally rendered (not just CSS-hidden) when collapsed, so
    // click every closed toggle before printing to ensure the PDF
    // actually contains the citation cards.
    const handleExport = useCallback(() => {
        if (turns.length === 0 || typeof window === "undefined") return;
        document
            .querySelectorAll<HTMLButtonElement>(
                '.ask-source-toggle[aria-expanded="false"]',
            )
            .forEach((btn) => btn.click());
        // Pre-seed the document title so the browser's "Save as PDF"
        // dialog proposes a meaningful filename. Restore right after
        // the dialog closes.
        const originalTitle = document.title;
        const firstQ = turns[0]?.question ?? "conversation";
        const safeTitle = firstQ
            .replace(/[\r\n]+/g, " ")
            .slice(0, 60)
            .trim();
        document.title = `Ask the Archive — ${safeTitle}`;
        const restore = () => {
            document.title = originalTitle;
            window.removeEventListener("afterprint", restore);
        };
        window.addEventListener("afterprint", restore);
        // Two rAFs so React commit + paint can flush the expanded
        // source lists into the DOM before the print snapshot.
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                window.print();
            });
        });
    }, [turns]);

    return (
        <PageShell variant="default" hasHeader>
            <TimeControls />
            <main className="ask-main">
                <div className="ask-page">
                    {showSidebar ? (
                        <AskSidebar
                            turns={turns}
                            onNewConversation={newConversation}
                            onClearConversation={clearConversation}
                            onExportConversation={handleExport}
                            canNewConversation={
                                turns.length > 0 || sessionGen > 0
                            }
                            canClearConversation={turns.length > 0}
                            canExportConversation={turns.length > 0}
                        />
                    ) : null}

                    <div className="ask-column">
                        {isFirstVisit ? (
                            <AskLanding onPickQuestion={submit} />
                        ) : (
                            <Transcript
                                turns={turns}
                                isHydrating={isHydrating}
                                expiredBanner={expiredBanner}
                                emptyReason={emptyReason}
                                onFollowUp={handleFollowUp}
                                onRetry={retry}
                            />
                        )}

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
