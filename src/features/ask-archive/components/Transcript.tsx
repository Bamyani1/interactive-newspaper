"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import type { Turn as TurnData, EmptyReason } from "../hooks/askReducer";
import { Turn } from "./Turn";
import { AskLanding } from "./AskLanding";

interface TranscriptProps {
  turns: TurnData[];
  isHydrating: boolean;
  expiredBanner: boolean;
  suggestionDate?: string;
  /** Real corpus size for the landing's stats line, counted server-side. */
  corpus?: { editionCount: number; articleCount: number };
  /**
   * Why the transcript is empty, when it is. It only ever adds a pill
   * above the landing — the landing itself renders for every empty state,
   * so no combination of flags can produce a blank scroller.
   */
  emptyReason: EmptyReason;
  onFollowUp: (question: string) => void;
  onRetry: (turnId: string) => void;
  onRegenerate?: (turnId: string) => void;
  onEditAndResend?: (turnId: string, question: string) => void;
  onFeedback?: (turnId: string, vote: "up" | "down") => void;
}

export const Transcript: React.FC<TranscriptProps> = ({
  turns,
  isHydrating,
  expiredBanner,
  suggestionDate,
  corpus,
  emptyReason,
  onFollowUp,
  onRetry,
  onRegenerate,
  onEditAndResend,
  onFeedback,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const prevTurnCountRef = useRef(turns.length);

  // Whether the reader is "following" the stream. Attachment changes
  // only on user scrolls: scrolling up detaches, returning to within
  // FOLLOW_THRESHOLD_PX of the bottom re-attaches. Content growth never
  // changes it — a large one-shot insertion (the source list mounting
  // mid-stream, an inline image loading) must not silently detach a
  // reader who never touched the scroll wheel.
  const followRef = useRef(false);
  // Set when we move scrollTop ourselves so the scroll listener can
  // tell programmatic scrolls from user intent.
  const programmaticScrollRef = useRef(false);
  // Mirrors "the reader has scrolled away from the bottom" into state so
  // the return-to-latest button can render. `followRef` cannot: it is a
  // ref precisely so streaming ticks don't re-render on scroll.
  const [isAwayFromLatest, setIsAwayFromLatest] = useState(false);
  const FOLLOW_THRESHOLD_PX = 200;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const onScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      // Updated for programmatic scrolls too — the button has to
      // disappear when we jump the reader to the bottom ourselves.
      setIsAwayFromLatest(distanceFromBottom > FOLLOW_THRESHOLD_PX);
      if (programmaticScrollRef.current) {
        programmaticScrollRef.current = false;
        return;
      }
      followRef.current = distanceFromBottom <= FOLLOW_THRESHOLD_PX;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const scrollToLatest = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    programmaticScrollRef.current = true;
    el.scrollTop = el.scrollHeight;
    followRef.current = true;
    setIsAwayFromLatest(false);
  }, []);

  // When a new turn is added, anchor the viewport to the top of that
  // turn so the reader starts at the beginning of the answer. While that
  // turn streams past the fold, follow the growing text — unless the
  // reader has scrolled away, in which case leave them be.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const isNewTurn = turns.length > prevTurnCountRef.current;
    prevTurnCountRef.current = turns.length;
    if (isNewTurn) {
      const lastTurn = el.querySelector(".ask-turn:last-of-type") as HTMLElement | null;
      if (!lastTurn) return;
      const turnTop = lastTurn.getBoundingClientRect().top;
      const containerTop = el.getBoundingClientRect().top;
      const next = el.scrollTop + (turnTop - containerTop);
      // >1px guard: a sub-pixel "change" may not fire a scroll
      // event, which would leave the programmatic flag stuck and
      // swallow the reader's next real scroll.
      if (Math.abs(next - el.scrollTop) > 1) {
        programmaticScrollRef.current = true;
        el.scrollTop = next;
      }
      // A fresh question starts the reader at its top, reading
      // along — following until they scroll away.
      followRef.current = true;
      return;
    }
    const lastTurn = turns[turns.length - 1];
    if (!lastTurn || lastTurn.status !== "streaming") return;
    if (!followRef.current) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight > 1) {
      programmaticScrollRef.current = true;
      el.scrollTop = el.scrollHeight;
    }
  }, [turns]);

  const isEmpty = turns.length === 0;

  // What the single live region says: the progress of the current turn,
  // which nothing else announces, and its terminal state. Never the answer
  // text, which assistive tech would re-read on every streamed word, and
  // never anything a visible status element already announces — the
  // restoration line, the cleared pill and the expiry notice each carry
  // their own role, and the error row is a `role="alert"`.
  const lastTurn = turns[turns.length - 1];
  const liveStatus = (() => {
    if (!lastTurn) return "";
    switch (lastTurn.status) {
      case "streaming":
        return lastTurn.stage ?? "Working on your question.";
      case "stopped":
        return "Answer stopped.";
      case "error":
        return "";
      default:
        return "Answer ready.";
    }
  })();

  return (
    <div
      ref={containerRef}
      className="ask-transcript"
      role="region"
      aria-label="Conversation transcript"
      aria-busy={isHydrating}
    >
      {/*
        One polite live region for progress and status, and nothing else.
        The scroller used to be a `role="log"`, which makes assistive tech
        announce every descendant as it changes: the landing suggestions
        on arrival, then each turn, then each streamed word. Announcing
        the stage instead is the useful half.
      */}
      <p className="sr-only" aria-live="polite">
        {liveStatus}
      </p>

      {/* The landing supplies the page's h1 while the transcript is empty.
          Once turns replace it the document had no h1 at all, so this
          stands in — exactly one, either way. */}
      {isEmpty ? null : <h1 className="sr-only">Ask the Archive</h1>}

      {expiredBanner ? (
        <div className="ask-expired-banner" role="status">
          <span className="ask-expired-banner-label">Notice</span>
          <span>
            {" "}
            — Server memory for this conversation has aged out. Follow-ups start fresh context.
          </span>
        </div>
      ) : null}

      {/*
        Every empty state renders the landing, so there is always
        something to click. Above it: the restoration line while a saved
        session is being checked, or the cleared pill after Clear all.
        The two used to be exclusive branches, and the combination of an
        expiry notice with a cleared transcript matched neither — that
        state rendered an entirely blank scroller.
      */}
      {isEmpty ? (
        <>
          {isHydrating ? (
            <p className="ask-hydrating-indicator" role="status" aria-live="polite">
              Checking for a saved conversation…
            </p>
          ) : null}
          {emptyReason === "cleared" ? (
            <p className="ask-cleared-indicator" role="status" aria-live="polite">
              All threads cleared — ask a new question below.
            </p>
          ) : null}
          <AskLanding
            onPickQuestion={onFollowUp}
            disabled={isHydrating}
            suggestionDate={suggestionDate}
            corpus={corpus}
          />
        </>
      ) : null}

      {turns.map((turn, i) => (
        <Turn
          key={turn.id}
          turn={turn}
          isLatest={i === turns.length - 1}
          onFollowUp={onFollowUp}
          onRetry={onRetry}
          onRegenerate={onRegenerate}
          onEditAndResend={onEditAndResend}
          onFeedback={onFeedback}
        />
      ))}

      {/*
        Sticky, and last in the scroller so it pins to the bottom edge.
        A reader who scrolls up to re-read an earlier answer loses the
        stream and previously had to drag all the way back down.
      */}
      {!isEmpty && isAwayFromLatest ? (
        <div className="ask-scroll-to-latest-slot">
          <button
            type="button"
            className="ask-scroll-to-latest"
            onClick={scrollToLatest}
            aria-label="Scroll to the latest answer"
            title="Scroll to the latest answer"
          >
            <ArrowDown size={16} aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  );
};
