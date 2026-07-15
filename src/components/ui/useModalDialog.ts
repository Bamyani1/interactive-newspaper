"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

// Modal portals are siblings under <body>, so DOM containment alone cannot
// identify a nested dialog. Keep a tiny open-order stack so only the topmost
// dialog handles Escape and focus trapping (for example, a photo lightbox
// opened from inside the Ask source reader).
const openModalStack: symbol[] = [];

interface UseModalDialogOptions {
  isOpen: boolean;
  onDismiss: () => void;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
}

/**
 * Shared modal behavior for portaled dialogs.
 *
 * The portal root must be a direct child of `document.body`. While open, its
 * siblings are made inert and hidden from assistive technology, body scroll is
 * locked, focus is contained, and the previously focused control is restored.
 */
export function useModalDialog({
  isOpen,
  onDismiss,
  initialFocusRef,
}: UseModalDialogOptions) {
  const portalRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const onDismissRef = useRef(onDismiss);
  const modalIdRef = useRef(Symbol("modal-dialog"));

  useLayoutEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!isOpen || !portalRef.current || !dialogRef.current) return undefined;

    const portal = portalRef.current;
    const dialog = dialogRef.current;
    const modalId = modalIdRef.current;
    openModalStack.push(modalId);
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    const siblings = Array.from(document.body.children).filter(
      (element): element is HTMLElement =>
        element instanceof HTMLElement && element !== portal,
    );
    const siblingState = siblings.map((element) => ({
      element,
      inert: element.inert,
      ariaHidden: element.getAttribute("aria-hidden"),
    }));

    siblingState.forEach(({ element }) => {
      element.inert = true;
      element.setAttribute("aria-hidden", "true");
    });
    document.body.style.overflow = "hidden";

    const getFocusable = () =>
      Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (element) => element.getAttribute("aria-hidden") !== "true",
      );

    const focusTarget = initialFocusRef?.current ?? getFocusable()[0] ?? dialog;
    focusTarget.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (openModalStack[openModalStack.length - 1] !== modalId) return;

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onDismissRef.current();
        return;
      }

      if (event.key !== "Tab") return;

      const focusable = getFocusable();
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      const stackIndex = openModalStack.lastIndexOf(modalId);
      if (stackIndex !== -1) openModalStack.splice(stackIndex, 1);
      document.body.style.overflow = previousOverflow;
      siblingState.forEach(({ element, inert, ariaHidden }) => {
        element.inert = inert;
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      });
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [initialFocusRef, isOpen]);

  return { portalRef, dialogRef };
}
