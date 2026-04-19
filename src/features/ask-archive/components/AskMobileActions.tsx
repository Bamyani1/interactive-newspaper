"use client";

import React from "react";
import { Plus, Eraser, Download } from "lucide-react";

interface AskMobileActionsProps {
    onNewConversation: () => void;
    onClearConversation: () => void;
    onExportConversation: () => void;
    canNewConversation: boolean;
    canClearConversation: boolean;
    canExportConversation: boolean;
}

/**
 * Mobile-only action strip for New / Clear / Export.
 *
 * Below 1024px the sidebar is hidden (layout collapses to one column),
 * so desktop users manage their session via the sidebar buttons and
 * mobile users had no way to reach them. This strip surfaces the same
 * three actions above the transcript on narrow viewports.
 *
 * Visibility is controlled in CSS (`display: flex` default, hidden at
 * `@media (min-width: 1024px)`) so the component can always be
 * rendered in the tree without a JS-side viewport check.
 */
export const AskMobileActions: React.FC<AskMobileActionsProps> = ({
    onNewConversation,
    onClearConversation,
    onExportConversation,
    canNewConversation,
    canClearConversation,
    canExportConversation,
}) => {
    return (
        <div
            className="ask-mobile-actions"
            role="group"
            aria-label="Conversation actions"
        >
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
                onClick={onClearConversation}
                disabled={!canClearConversation}
                aria-label="Clear the current thread"
            >
                <Eraser size={14} aria-hidden="true" />
                <span>Clear</span>
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
