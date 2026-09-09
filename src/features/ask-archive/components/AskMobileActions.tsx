"use client";

import React from "react";
import { Plus, Eraser, Download, MessagesSquare } from "lucide-react";

interface AskMobileActionsProps {
  onOpenThreads: () => void;
  threadCount: number;
  onNewConversation: () => void;
  onClearAllThreads: () => void;
  onExportConversation: () => void;
  canNewConversation: boolean;
  canClearAllThreads: boolean;
  canExportConversation: boolean;
}

/**
 * Mobile-only action strip for Threads / New / Clear / Export.
 *
 * Below 1024px the sidebar is hidden (layout collapses to one column),
 * so desktop users manage their session via the sidebar buttons and
 * mobile users had no way to reach them — including the thread archive
 * itself, which had no mobile affordance at all. This strip surfaces all
 * four above the transcript on narrow viewports.
 *
 * Visibility is controlled in CSS (`display: flex` default, hidden at
 * `@media (min-width: 1024px)`) so the component can always be
 * rendered in the tree without a JS-side viewport check.
 */
export const AskMobileActions: React.FC<AskMobileActionsProps> = ({
  onOpenThreads,
  threadCount,
  onNewConversation,
  onClearAllThreads,
  onExportConversation,
  canNewConversation,
  canClearAllThreads,
  canExportConversation,
}) => {
  return (
    <div className="ask-mobile-actions" role="group" aria-label="Conversation actions">
      <button
        type="button"
        className="ask-mobile-action"
        onClick={onOpenThreads}
        disabled={threadCount === 0}
        aria-label="Show saved threads"
      >
        <MessagesSquare size={14} aria-hidden="true" />
        <span>Threads</span>
      </button>
      <button
        type="button"
        className="ask-mobile-action"
        onClick={onNewConversation}
        disabled={!canNewConversation}
        aria-label="Start a new conversation"
      >
        <Plus size={14} aria-hidden="true" />
        <span>New</span>
      </button>
      <button
        type="button"
        className="ask-mobile-action"
        onClick={onClearAllThreads}
        disabled={!canClearAllThreads}
        aria-label="Clear all threads"
      >
        <Eraser size={14} aria-hidden="true" />
        <span>Clear all</span>
      </button>
      <button
        type="button"
        className="ask-mobile-action"
        onClick={onExportConversation}
        disabled={!canExportConversation}
        aria-label="Export the conversation as a PDF"
      >
        <Download size={14} aria-hidden="true" />
        <span>Export</span>
      </button>
    </div>
  );
};
