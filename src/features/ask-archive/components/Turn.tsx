"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/src/components/ui/primitives";
import type { Turn as TurnData } from "../hooks/askReducer";
import { Markdown } from "./Markdown";
import { SourceList } from "./SourceList";
import { FollowUpQuestions } from "./FollowUpQuestions";
import { LowConfidenceCaveat } from "./LowConfidenceCaveat";
import { CoverageNote } from "./CoverageNote";
import { ErrorInline } from "./ErrorInline";
import {
  dedupSourceImages,
  extractInlineImageUrls,
  indexImagesByUrl,
} from "../lib/dedup-source-images";
import { trimIncompleteMarkdown } from "../lib/trim-incomplete-markdown";
import { AnswerImageContext, type AnswerImageContextValue } from "./AnswerImageContext";
import { PhotosPanel } from "./PhotosPanel";
import { Lightbox } from "@/src/components/ui/lightbox";
import { TurnActions } from "./TurnActions";
import { flattenCitations } from "../lib/citations";

interface TurnProps {
  turn: TurnData;
  isLatest?: boolean;
  onFollowUp: (question: string) => void;
  onRetry: (turnId: string) => void;
  /** Ask the same question again. Latest turn only — see useAskArchive. */
  onRegenerate?: (turnId: string) => void;
  /** Reword the question and answer that instead. Latest turn only. */
  onEditAndResend?: (turnId: string, question: string) => void;
  /** Rate the answer. Offered on any settled turn that reached the server. */
  onFeedback?: (turnId: string, vote: "up" | "down") => void;
  exportMode?: boolean;
}

// A stable identity for "no images", so the closed Lightbox doesn't see a
// fresh array on every render.
const EMPTY_IMAGES: Array<{ src: string; caption?: string }> = [];

function buildArticleIdIndex(sources: TurnData["sourceArticles"]): Map<string, number> {
  const map = new Map<string, number>();
  sources.forEach((s, i) => map.set(s.id, i + 1));
  return map;
}

export const Turn: React.FC<TurnProps> = ({
  turn,
  isLatest = true,
  onFollowUp,
  onRetry,
  onRegenerate,
  onEditAndResend,
  onFeedback,
  exportMode = false,
}) => {
  const articleIdIndex = useMemo(
    () => buildArticleIdIndex(turn.sourceArticles),
    [turn.sourceArticles]
  );

  const turnImages = useMemo(() => dedupSourceImages(turn.sourceArticles), [turn.sourceArticles]);
  const imageIndex = useMemo(() => indexImagesByUrl(turnImages), [turnImages]);

  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const lightboxImages = useMemo(
    () => turnImages.map((img) => ({ src: img.src, caption: img.caption })),
    [turnImages]
  );

  const openLightbox = useCallback(
    (url: string) => {
      const match = imageIndex.get(url);
      if (match) setLightboxIndex(match.index);
    },
    [imageIndex]
  );

  const contextValue = useMemo<AnswerImageContextValue>(
    () => ({ metaByUrl: imageIndex, openLightbox }),
    [imageIndex, openLightbox]
  );

  const isStreaming = turn.status === "streaming";
  // The reader stopped this answer, switched away from it, or asked
  // something else before it finished. The text it did receive is real
  // and stays on screen; what it is missing is an ending.
  const isStopped = turn.status === "stopped";
  const isError = turn.status === "error";
  const hasText = turn.answer.trim().length > 0;
  const showStagePill = isStreaming && !hasText;

  // While streaming, hold back half-arrived markdown (a partial image
  // URL, a dangling "[Source", an unclosed "**") so raw syntax never
  // flashes. The reducer keeps the full text; done renders untrimmed.
  // A stopped answer was cut at an arbitrary character, so it keeps the
  // trim permanently — there is no later frame to complete the syntax.
  const displayAnswer =
    isStreaming || isStopped || isError ? trimIncompleteMarkdown(turn.answer) : turn.answer;

  // Sources arrive with the metadata event, several seconds before the
  // first answer token — show them immediately so the wait is spent
  // reading evidence, not watching dots.
  const showSources = turn.sourceArticles.length > 0;

  // Photos the LLM already embedded inline shouldn't re-appear in
  // the "More pictures" grid, otherwise the reader sees the same
  // thumbnail twice.
  const moreImages = useMemo(() => {
    const inlined = extractInlineImageUrls(turn.answer);
    if (inlined.size === 0) return turnImages;
    return turnImages.filter((img) => {
      if (inlined.has(img.src)) return false;
      try {
        if (inlined.has(decodeURI(img.src))) return false;
      } catch {
        // Malformed URL — fall through; raw compare already ran.
      }
      return true;
    });
  }, [turnImages, turn.answer]);

  const showPhotosPanel = turn.mode === "visual" && turn.status === "done" && moreImages.length > 0;

  // Re-running a turn rewrites it in place, which only the final turn can
  // do: an earlier one would need the server to truncate the history
  // behind it. Every earlier turn therefore reads as a record.
  const canRerun = isLatest && !exportMode && !isStreaming;
  const [draft, setDraft] = useState<string | null>(null);
  // Derived, not synced: the moment this turn stops being the rerunnable
  // one — it starts streaming, or a newer turn arrives — the editor is
  // describing a question the reader can no longer replace, so it closes
  // on its own rather than through an effect that chases the status.
  const isEditing = draft !== null && canRerun;
  const draftRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isEditing) draftRef.current?.focus();
  }, [isEditing]);

  const commitEdit = useCallback(() => {
    if (draft === null) return;
    const trimmed = draft.trim();
    setDraft(null);
    if (!trimmed || trimmed === turn.question) return;
    onEditAndResend?.(turn.id, trimmed);
  }, [draft, onEditAndResend, turn.id, turn.question]);

  // What the clipboard gets: the answer as written, with citations
  // flattened to [N] so a pasted answer keeps its evidence instead of
  // anchors that lead nowhere outside the page.
  const copyText = useMemo(
    () => (hasText ? flattenCitations(turn.answer, articleIdIndex).trim() : ""),
    [hasText, turn.answer, articleIdIndex]
  );

  // Hoisted so an error turn shows the same prose an ordinary turn does.
  // A mid-stream failure used to replace everything the reader had already
  // read with a bare error row, which looked like the answer was retracted.
  const answerBlock = hasText ? (
    <>
      <p className="ask-turn-assistant-label">The desk replies</p>
      <div className="ask-turn-answer" data-streaming={isStreaming ? "true" : undefined}>
        <AnswerImageContext.Provider value={contextValue}>
          <Markdown articleIdIndex={articleIdIndex} turnId={turn.id}>
            {displayAnswer}
          </Markdown>
        </AnswerImageContext.Provider>
      </div>
    </>
  ) : null;

  // Also outside the success branch: a failed or interrupted answer is
  // exactly the one a reader most wants to run again.
  // Rating needs a requestId to join against server-side — a turn that
  // was stopped or failed before the metadata frame has none, so it is
  // read-only. Copy and Regenerate stay available on those.
  const canRate =
    turn.status === "done" && turn.requestId.length > 0 && !exportMode && Boolean(onFeedback);
  const canRegenerate = canRerun && Boolean(onRegenerate);
  const showActions = !exportMode && !isEditing && !isStreaming && (hasText || canRegenerate);

  const actionsRow = showActions ? (
    <TurnActions
      copyText={copyText}
      feedback={turn.feedback}
      onRegenerate={canRegenerate ? () => onRegenerate?.(turn.id) : undefined}
      onFeedback={canRate ? (vote) => onFeedback?.(turn.id, vote) : undefined}
    />
  ) : null;

  return (
    <article className="ask-turn">
      <div className="ask-turn-user" aria-label="Your question">
        <div className="ask-turn-user-head">
          <p className="ask-turn-user-label">You asked</p>
          {canRerun && onEditAndResend && !isEditing ? (
            <Button
              variant="icon"
              className="ask-turn-action"
              onClick={() => setDraft(turn.question)}
              aria-label="Edit question"
              title="Edit question"
            >
              <Pencil size={14} aria-hidden="true" />
            </Button>
          ) : null}
        </div>
        {isEditing ? (
          <form
            className="ask-turn-edit"
            onSubmit={(e) => {
              e.preventDefault();
              commitEdit();
            }}
          >
            <textarea
              ref={draftRef}
              className="ask-turn-edit-field"
              value={draft ?? ""}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  commitEdit();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setDraft(null);
                }
              }}
              rows={2}
              aria-label="Edit your question"
            />
            <div className="ask-turn-edit-actions">
              <Button type="submit" variant="secondary" className="ask-turn-edit-send">
                Ask again
              </Button>
              <Button type="button" variant="ghost" onClick={() => setDraft(null)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          // An h2 so the questions form the document outline a reader can
          // navigate by, under the page's single h1.
          <h2 className="ask-turn-user-bubble">{turn.question}</h2>
        )}
      </div>

      <div className="ask-turn-assistant" aria-live="polite" aria-atomic="false">
        {/* Above the answer, and available from the metadata frame — so a
            thin answer arrives already framed by how thin the archive is
            for that question, instead of being explained afterwards. */}
        {isError ? null : <CoverageNote coverage={turn.meta?.coverage} />}
        {answerBlock}
        {isError ? (
          <>
            <ErrorInline
              kind={turn.errorKind ?? "server"}
              message={turn.errorMessage ?? ""}
              retryAfterSec={turn.retryAfterSec}
              onRetry={() => onRetry(turn.id)}
              stoppedEarly={hasText}
            />
            {actionsRow}
          </>
        ) : (
          <>
            {showStagePill ? (
              <div className="ask-thinking-rule" aria-label="Thinking">
                <span>{turn.stage ?? "Thinking…"}</span>
                <span className="ask-thinking-dot" aria-hidden="true" />
                <span className="ask-thinking-dot" aria-hidden="true" />
                <span className="ask-thinking-dot" aria-hidden="true" />
              </div>
            ) : null}

            {isStopped ? (
              <p className="ask-turn-stopped">
                {hasText ? "Stopped before the answer finished." : "Stopped before it answered."}
              </p>
            ) : null}

            {turn.status === "done" ? (
              <>
                <LowConfidenceCaveat confidence={turn.confidence} />
                {showPhotosPanel ? (
                  <PhotosPanel images={moreImages} onOpenUrl={openLightbox} />
                ) : null}
              </>
            ) : null}

            {showSources ? (
              <SourceList
                sources={turn.sourceArticles}
                turnId={turn.id}
                defaultExpanded={exportMode}
                interactive={!exportMode}
              />
            ) : null}

            {actionsRow}

            {turn.status === "done" &&
            isLatest &&
            !exportMode &&
            turn.followUpQuestions &&
            turn.followUpQuestions.length > 0 ? (
              <FollowUpQuestions
                questions={turn.followUpQuestions}
                onSelect={onFollowUp}
                disabled={isStreaming}
              />
            ) : null}
          </>
        )}
      </div>

      {exportMode ? null : (
        <Lightbox
          images={lightboxIndex !== null ? lightboxImages : EMPTY_IMAGES}
          initialIndex={lightboxIndex ?? 0}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </article>
  );
};
