"use client";

import React, { useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useModalDialog } from "@/shared/ui/useModalDialog";
import type { ThreadSummary } from "../hooks/askReducer";
import { ThreadList } from "./ThreadList";

interface ThreadDrawerProps {
  isOpen: boolean;
  threads: ThreadSummary[];
  activeThreadId: string | null;
  onClose: () => void;
  onSwitchThread: (threadId: string) => void;
  onRenameThread: (threadId: string, title: string) => void;
  onRequestDeleteThread: (thread: ThreadSummary) => void;
}

/**
 * The thread archive on narrow viewports, where the sidebar is hidden.
 *
 * A bottom sheet rather than a slide-in panel: a phone's reachable area
 * is the bottom of the screen, and the list is what the reader came for.
 * It renders the same ThreadList the sidebar does, so a thread offers
 * the same three actions in both places.
 */
export const ThreadDrawer: React.FC<ThreadDrawerProps> = ({
  isOpen,
  threads,
  activeThreadId,
  onClose,
  onSwitchThread,
  onRenameThread,
  onRequestDeleteThread,
}) => {
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const { portalRef, dialogRef } = useModalDialog({
    isOpen,
    onDismiss: onClose,
    initialFocusRef: closeButtonRef,
  });

  if (!isOpen || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={portalRef}
      className="ask-thread-drawer-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="ask-thread-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="ask-thread-drawer-head">
          <h2 id={titleId}>Threads</h2>
          <button
            ref={closeButtonRef}
            type="button"
            className="ask-thread-tool"
            onClick={onClose}
            aria-label="Close threads"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <div className="ask-thread-drawer-list">
          <ThreadList
            threads={threads}
            activeThreadId={activeThreadId}
            // Opening a thread is why the sheet exists, so it closes on
            // the way through rather than leaving the reader to dismiss
            // a panel covering the answer they just asked for.
            onSwitchThread={(id) => {
              onSwitchThread(id);
              onClose();
            }}
            onRenameThread={onRenameThread}
            onRequestDelete={(thread) => {
              onClose();
              onRequestDeleteThread(thread);
            }}
          />
        </div>
      </div>
    </div>,
    document.body
  );
};
