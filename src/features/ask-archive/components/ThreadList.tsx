"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Check, Pencil, Trash2, X } from "lucide-react";
import type { ThreadSummary } from "../hooks/askReducer";
import { MAX_THREAD_TITLE_LENGTH } from "../hooks/useAskArchive";

interface ThreadListProps {
  threads: ThreadSummary[];
  activeThreadId: string | null;
  onSwitchThread: (threadId: string) => void;
  onRenameThread: (threadId: string, title: string) => void;
  onRequestDelete: (thread: ThreadSummary) => void;
}

/** Longer than a sidebar row can show; the full text stays in `title`. */
const DISPLAY_LIMIT = 60;

export function threadLabel(thread: ThreadSummary): string {
  return thread.title?.trim() || thread.firstQuestion;
}

/** Trim at a word boundary so a row never ends mid-word. */
export function truncateAtWord(text: string, limit = DISPLAY_LIMIT): string {
  if (text.length <= limit) return text;
  const clipped = text.slice(0, limit);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${(lastSpace > limit * 0.6 ? clipped.slice(0, lastSpace) : clipped).trimEnd()}…`;
}

export function formatRelativeTime(ts: number): string {
  const delta = Date.now() - ts;
  const mins = Math.round(delta / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

/**
 * The archived threads, with the per-thread tools.
 *
 * Shared by the desktop sidebar and the mobile drawer so a thread offers
 * the same three actions wherever it is listed. Opening stays a plain
 * button whose accessible name is "Open thread: <title>"; rename and
 * delete sit beside it rather than inside it, because a control nested
 * in a button is not reachable.
 */
export const ThreadList: React.FC<ThreadListProps> = ({
  threads,
  activeThreadId,
  onSwitchThread,
  onRenameThread,
  onRequestDelete,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId) inputRef.current?.select();
  }, [editingId]);

  const commit = useCallback(() => {
    if (!editingId) return;
    onRenameThread(editingId, draft);
    setEditingId(null);
  }, [draft, editingId, onRenameThread]);

  if (threads.length === 0) {
    return (
      <p className="ask-sidebar-threads-empty">No conversation yet. Ask a question to begin.</p>
    );
  }

  return (
    <>
      {threads.map((thread) => {
        const isActive = thread.id === activeThreadId;
        const label = threadLabel(thread);

        if (editingId === thread.id) {
          return (
            <form
              key={thread.id}
              className="ask-thread-rename"
              onSubmit={(e) => {
                e.preventDefault();
                commit();
              }}
            >
              <input
                ref={inputRef}
                className="ask-thread-rename-field"
                value={draft}
                maxLength={MAX_THREAD_TITLE_LENGTH}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setEditingId(null);
                  }
                }}
                // Blur commits, matching the inline-rename convention:
                // clicking away keeps what was typed rather than losing it.
                onBlur={commit}
                aria-label={`Rename thread: ${label}`}
              />
              <button
                type="submit"
                className="ask-thread-tool"
                aria-label="Save thread name"
                title="Save"
              >
                <Check size={13} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="ask-thread-tool"
                // Mouse-down beats the field's blur, so Cancel actually
                // cancels instead of committing on the way out.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setEditingId(null)}
                aria-label="Cancel rename"
                title="Cancel"
              >
                <X size={13} aria-hidden="true" />
              </button>
            </form>
          );
        }

        return (
          <div
            key={thread.id}
            className="ask-thread-row"
            data-active={isActive ? "true" : undefined}
          >
            <button
              type="button"
              className="ask-sidebar-thread"
              data-active={isActive ? "true" : undefined}
              onClick={() => onSwitchThread(thread.id)}
              aria-current={isActive ? "true" : undefined}
              aria-label={`Open thread: ${label}`}
              title={label}
            >
              <span className="ask-sidebar-thread-title">{truncateAtWord(label)}</span>
              <span className="ask-sidebar-thread-meta">
                {thread.turnCount === 1 ? "1 turn" : `${thread.turnCount} turns`}
                {" · "}
                {formatRelativeTime(thread.lastUpdatedAt)}
                {isActive ? " · active" : null}
              </span>
            </button>
            <div className="ask-thread-tools">
              <button
                type="button"
                className="ask-thread-tool"
                onClick={() => {
                  setDraft(label);
                  setEditingId(thread.id);
                }}
                aria-label={`Rename thread: ${label}`}
                title="Rename"
              >
                <Pencil size={13} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="ask-thread-tool"
                onClick={() => onRequestDelete(thread)}
                aria-label={`Delete thread: ${label}`}
                title="Delete"
              >
                <Trash2 size={13} aria-hidden="true" />
              </button>
            </div>
          </div>
        );
      })}
    </>
  );
};
