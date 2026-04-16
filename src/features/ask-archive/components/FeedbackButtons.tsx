"use client";

import React, { useState } from "react";
import { ThumbsUp, ThumbsDown } from "lucide-react";
import type { AskResponse } from "@/src/types";

interface FeedbackButtonsProps {
  response: AskResponse;
}

type FeedbackState = "prompt" | "collecting_comment" | "submitting" | "thanks" | "error";

const MAX_COMMENT_LENGTH = 1000;

export const FeedbackButtons: React.FC<FeedbackButtonsProps> = ({ response }) => {
  const [state, setState] = useState<FeedbackState>("prompt");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingVote, setPendingVote] = useState<"up" | "down" | null>(null);
  const [comment, setComment] = useState("");

  const chooseVote = (vote: "up" | "down") => {
    if (!response.requestId || state === "submitting") return;
    setPendingVote(vote);
    setComment("");
    setErrorMessage(null);
    setState("collecting_comment");
  };

  const sendFeedback = async (includeComment: boolean) => {
    if (!response.requestId || !pendingVote) return;
    setState("submitting");
    setErrorMessage(null);

    const trimmed = comment.trim();
    const payload: Record<string, unknown> = {
      requestId: response.requestId,
      vote: pendingVote,
      question: response.question,
      answer: response.answer,
      confidence: response.confidence,
      mode: response.mode,
      citations: response.citations,
    };
    if (includeComment && trimmed.length > 0) {
      payload.comment = trimmed.slice(0, MAX_COMMENT_LENGTH);
    }
    // Best-effort: attach the session id so votes can be joined back to
    // the conversation the answer came from. Missing/unavailable storage
    // is non-fatal — the feedback row is still useful without it.
    if (typeof window !== "undefined") {
      try {
        const sessionId = window.localStorage.getItem("owu-ask-session-id");
        if (sessionId) payload.sessionId = sessionId;
      } catch {
        // storage disabled; skip
      }
    }

    try {
      const res = await fetch("/api/ask/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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

  if (state === "collecting_comment" || state === "submitting") {
    const remaining = MAX_COMMENT_LENGTH - comment.length;
    return (
      <div className="ask-feedback-comment" aria-live="polite">
        <div className="ask-feedback-row">
          <span className="ask-feedback-label">
            {pendingVote === "up" ? "What worked?" : "What went wrong?"}
          </span>
          <span className="ask-feedback-vote-indicator" aria-hidden="true">
            {pendingVote === "up" ? <ThumbsUp size={12} /> : <ThumbsDown size={12} />}
          </span>
        </div>
        <textarea
          className="ask-feedback-textarea"
          value={comment}
          onChange={(e) => setComment(e.target.value.slice(0, MAX_COMMENT_LENGTH))}
          placeholder="Optional — tell us more"
          aria-label="Feedback comment (optional)"
          disabled={state === "submitting"}
          rows={3}
        />
        <div className="ask-feedback-comment-actions">
          <span
            className={`ask-feedback-count ${remaining < 100 ? "ask-feedback-count--warn" : ""}`}
          >
            {remaining} chars left
          </span>
          <button
            type="button"
            className="ask-feedback-text-btn"
            onClick={() => sendFeedback(false)}
            disabled={disabled}
          >
            Skip
          </button>
          <button
            type="button"
            className="ask-feedback-send-btn"
            onClick={() => sendFeedback(true)}
            disabled={disabled}
          >
            {state === "submitting" ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="ask-feedback-row" aria-live="polite">
      <span className="ask-feedback-label">Was this helpful?</span>
      <button
        type="button"
        className="ask-feedback-btn"
        onClick={() => chooseVote("up")}
        disabled={disabled}
        aria-label="Mark this answer as helpful"
      >
        <ThumbsUp size={14} />
      </button>
      <button
        type="button"
        className="ask-feedback-btn"
        onClick={() => chooseVote("down")}
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
