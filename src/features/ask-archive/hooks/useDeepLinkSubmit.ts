"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";

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
 * with a `q=` param and the restored conversation is empty, auto-submit
 * the question once and strip the param so a refresh doesn't re-submit.
 *
 * Guarded so it only fires once, waits for hydration, and respects
 * an existing conversation. A deep-link question that collides with an
 * existing conversation is consumed without submission so clearing that
 * conversation later cannot unexpectedly fire the stale URL query.
 */
export function useDeepLinkSubmit({
    isHydrating,
    turnCount,
    submit,
}: UseDeepLinkSubmitArgs): void {
    const searchParams = useSearchParams();
    const firedRef = useRef(false);

    useEffect(() => {
        if (firedRef.current) return;
        if (isHydrating) return;
        const q = searchParams?.get("q")?.trim();
        if (!q) return;
        firedRef.current = true;
        if (turnCount === 0) submit(q);

        // This only consumes a URL parameter; it is not a route navigation.
        // Next patches native history calls so the App Router stays in sync,
        // including in optimized production builds where same-route replaces
        // can preserve the route cache's original canonical query string.
        window.history.replaceState(null, "", "/ask");
    }, [isHydrating, turnCount, searchParams, submit]);
}
