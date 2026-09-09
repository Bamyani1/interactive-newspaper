"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, RotateCcw, ThumbsDown, ThumbsUp } from "lucide-react";
import { Button } from "@/src/components/ui/primitives";

interface TurnActionsProps {
  /**
   * The answer as it should land on the clipboard — citations already
   * `[N]`. Empty when the turn failed before writing anything, and the
   * copy button is then omitted rather than offering an empty clipboard.
   */
  copyText: string;
  feedback?: "up" | "down";
  /** Only the final turn can be re-run; earlier ones read as a record. */
  onRegenerate?: () => void;
  onFeedback?: (vote: "up" | "down") => void;
}

const COPIED_RESET_MS = 1500;

/**
 * Copy the answer without depending on the async Clipboard API, which is
 * unavailable outside a secure context and in older Safari. The textarea
 * is off-screen rather than `display: none` so the selection is real.
 */
function copyViaSelection(text: string): boolean {
  if (typeof document === "undefined") return false;
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.top = "-1000px";
  field.style.opacity = "0";
  document.body.appendChild(field);
  try {
    field.select();
    return document.execCommand?.("copy") ?? false;
  } catch {
    return false;
  } finally {
    field.remove();
  }
}

/**
 * The row of controls under a settled answer: copy, rate, re-run.
 *
 * Every button is present for the same reason — the reader has just
 * finished reading and is deciding what to do with what they got. They
 * stay hidden behind a low opacity until hover or focus so they never
 * compete with the prose.
 */
export const TurnActions: React.FC<TurnActionsProps> = ({
  copyText,
  feedback,
  onRegenerate,
  onFeedback,
}) => {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    },
    []
  );

  const handleCopy = useCallback(() => {
    const flash = () => {
      setCopied(true);
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
      resetTimer.current = window.setTimeout(() => setCopied(false), COPIED_RESET_MS);
    };
    const clipboard = navigator?.clipboard;
    if (clipboard?.writeText) {
      clipboard.writeText(copyText).then(flash, () => {
        if (copyViaSelection(copyText)) flash();
      });
      return;
    }
    if (copyViaSelection(copyText)) flash();
  }, [copyText]);

  return (
    <div className="ask-turn-actions">
      {copyText.trim().length > 0 ? (
        <Button
          variant="icon"
          className="ask-turn-action"
          onClick={handleCopy}
          aria-label={copied ? "Answer copied" : "Copy answer"}
          title={copied ? "Copied" : "Copy answer"}
        >
          {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
        </Button>
      ) : null}

      {onFeedback ? (
        <>
          <Button
            variant="icon"
            className="ask-turn-action"
            onClick={() => onFeedback("up")}
            aria-pressed={feedback === "up"}
            aria-label="Good answer"
            title="Good answer"
          >
            <ThumbsUp size={14} aria-hidden="true" />
          </Button>
          <Button
            variant="icon"
            className="ask-turn-action"
            onClick={() => onFeedback("down")}
            aria-pressed={feedback === "down"}
            aria-label="Bad answer"
            title="Bad answer"
          >
            <ThumbsDown size={14} aria-hidden="true" />
          </Button>
        </>
      ) : null}

      {onRegenerate ? (
        <Button
          variant="icon"
          className="ask-turn-action"
          onClick={onRegenerate}
          aria-label="Regenerate answer"
          title="Regenerate answer"
        >
          <RotateCcw size={14} aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  );
};
