"use client";

import React, { useId, useRef } from "react";
import { createPortal } from "react-dom";
import { TriangleAlert } from "lucide-react";
import { useModalDialog } from "@/shared/ui/useModalDialog";

interface ClearThreadsDialogProps {
  isOpen: boolean;
  threadCount: number;
  onCancel: () => void;
  onConfirm: () => void;
  /**
   * Copy overrides. Deleting one thread is the same interruption with a
   * narrower scope, so it reuses this dialog rather than growing a second
   * one that would have to repeat the focus and dismissal handling.
   */
  title?: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

/**
 * Confirmation gate for "Clear all threads".
 *
 * Clearing wipes every local thread and best-effort DELETEs the matching
 * server sessions, so it needs an explicit confirm — `alertdialog` rather
 * than `dialog` because it interrupts to warn. Focus starts on Cancel so a
 * stray Enter keeps the threads.
 */
export const ClearThreadsDialog: React.FC<ClearThreadsDialogProps> = ({
  isOpen,
  threadCount,
  onCancel,
  onConfirm,
  title,
  body,
  confirmLabel,
  cancelLabel,
}) => {
  const titleId = useId();
  const descriptionId = useId();
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const { portalRef, dialogRef } = useModalDialog({
    isOpen,
    onDismiss: onCancel,
    initialFocusRef: cancelButtonRef,
  });

  if (!isOpen || typeof document === "undefined") return null;

  const threadLabel = threadCount === 1 ? "thread" : "threads";

  return createPortal(
    <div
      ref={portalRef}
      className="ask-clear-dialog-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        className="ask-clear-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
      >
        <div className="ask-clear-dialog-heading">
          <TriangleAlert size={20} aria-hidden="true" />
          <div>
            <p className="ask-clear-dialog-kicker">Permanent action</p>
            <h2 id={titleId}>{title ?? "Clear all threads?"}</h2>
          </div>
        </div>
        <p id={descriptionId} className="ask-clear-dialog-copy">
          {body ??
            `This will permanently remove ${threadCount} saved ${threadLabel} and all conversation history. This cannot be undone.`}
        </p>
        <div className="ask-clear-dialog-actions">
          <button
            ref={cancelButtonRef}
            type="button"
            className="ask-clear-dialog-button"
            onClick={onCancel}
          >
            {cancelLabel ?? "Keep threads"}
          </button>
          <button
            type="button"
            className="ask-clear-dialog-button ask-clear-dialog-confirm"
            onClick={onConfirm}
          >
            {confirmLabel ?? "Clear all"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
