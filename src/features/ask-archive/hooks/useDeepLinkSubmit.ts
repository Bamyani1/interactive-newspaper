"use client";

import { useEffect, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";

interface UseDeepLinkSubmitArgs {
    /** True while the session-restore roundtrip is in flight. */
    isHydrating: boolean;
    /** Number of turns currently in the conversation. */
    turnCount: number;
    /** Submit handler from `useAskArchive`. */
    submit: (question: string) => void;
}

/**
 * Deep-link support for `/ask?q=<encoded>` — when the page is opened
 * with a `q=` param and the conversation is empty, auto-submit the
 * question once and strip the param so a refresh doesn't re-submit.
 *
 * Guarded so it only fires once, waits for hydration, and respects
 * an existing conversation (if the user landed here mid-session,
 * we don't hijack it).
 */
export function useDeepLinkSubmit({
    isHydrating,
    turnCount,
    submit,
}: UseDeepLinkSubmitArgs): void {
    const searchParams = useSearchParams();
    const router = useRouter();
    const firedRef = useRef(false);

    useEffect(() => {
        if (firedRef.current) return;
        if (isHydrating) return;
        if (turnCount > 0) return;
        const q = searchParams?.get("q")?.trim();
        if (!q) return;
        firedRef.current = true;
        submit(q);
        router.replace("/ask", { scroll: false });
    }, [isHydrating, turnCount, searchParams, submit, router]);
}
