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
        clearConversation,
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
                    <AskSidebar
                        turns={turns}
                        onClearConversation={clearConversation}
                        onExportConversation={handleExport}
                        canClearConversation={turns.length > 0}
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
