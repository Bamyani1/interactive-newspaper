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
  /** Archives the open thread and mints a fresh session. */
  startNewConversation: () => void;
}

/**
 * Deep-link support for `/ask?q=<encoded>` — when the page is opened
 * with a `q=` param and the restored conversation is empty, auto-submit
 * the question once and strip the param so a refresh doesn't re-submit.
 *
 * Guarded so it only fires once and waits for hydration. When a
 * conversation is already open the question opens a fresh thread rather
 * than being dropped — the reader clicked a suggestion and expects an
 * answer, and the previous thread stays reachable in the sidebar. Firing
 * once per mount is what stops a stale URL query being released again
 * after the conversation is later cleared.
 */
export function useDeepLinkSubmit({
  isHydrating,
  turnCount,
  submit,
  startNewConversation,
}: UseDeepLinkSubmitArgs): void {
  const searchParams = useSearchParams();
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;
    if (isHydrating) return;
    const q = searchParams?.get("q")?.trim();
    if (!q) return;
    firedRef.current = true;
    if (turnCount > 0) startNewConversation();
    submit(q);

    // Consume only `q`. Rewriting the URL to a bare "/ask" discarded every
    // other parameter with it — a campaign tag, a debug flag, anything a
    // link carried alongside the question.
    //
    // This is a parameter edit, not a route navigation. Next patches native
    // history calls so the App Router stays in sync, including in optimized
    // production builds where a same-route replace can otherwise preserve
    // the route cache's original canonical query string.
    const remaining = new URLSearchParams(window.location.search);
    remaining.delete("q");
    const query = remaining.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`
    );
  }, [isHydrating, turnCount, searchParams, submit, startNewConversation]);
}
