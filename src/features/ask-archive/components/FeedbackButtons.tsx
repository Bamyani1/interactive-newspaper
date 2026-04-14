"use client";

import React, { useState } from "react";
import { ThumbsUp, ThumbsDown } from "lucide-react";
import type { AskResponse } from "@/src/types";

interface FeedbackButtonsProps {
  response: AskResponse;
}

type FeedbackState = "prompt" | "submitting" | "thanks" | "error";

export const FeedbackButtons: React.FC<FeedbackButtonsProps> = ({ response }) => {
  const [state, setState] = useState<FeedbackState>("prompt");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const submit = async (vote: "up" | "down") => {
    if (!response.requestId || state === "submitting") return;

    setState("submitting");
    setErrorMessage(null);

    try {
      const res = await fetch("/api/ask/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: response.requestId,
          vote,
          question: response.question,
          answer: response.answer,
          confidence: response.confidence,
          mode: response.mode,
          citations: response.citations,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `Request failed: ${res.status}`);
      }

      setState("thanks");
    } catch (err) {
      setState("error");
      setErrorMessage(err instanceof Error ? err.message : "Something went wrong");
    }
  };

  const disabled = !response.requestId || state === "submitting";

  if (state === "thanks") {
    return (
      <div className="ask-feedback-row" aria-live="polite">
        <span className="ask-feedback-label">Thanks for the feedback.</span>
      </div>
    );
  }

  return (
    <div className="ask-feedback-row" aria-live="polite">
      <span className="ask-feedback-label">Was this helpful?</span>
      <button
        type="button"
        className="ask-feedback-btn"
        onClick={() => submit("up")}
        disabled={disabled}
        aria-label="Mark this answer as helpful"
      >
        <ThumbsUp size={14} />
      </button>
      <button
        type="button"
        className="ask-feedback-btn"
        onClick={() => submit("down")}
        disabled={disabled}
        aria-label="Mark this answer as unhelpful"
      >
        <ThumbsDown size={14} />
      </button>
      {state === "error" && errorMessage && (
        <span className="ask-feedback-error" role="alert">
          {errorMessage}
        </span>
      )}
    </div>
  );
};
