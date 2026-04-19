"use client";

import React from "react";
import { Plus, Eraser, Download } from "lucide-react";
import type { Turn } from "../hooks/askReducer";

interface AskSidebarProps {
    turns: Turn[];
    onNewConversation: () => void;
    onClearConversation: () => void;
    onExportConversation: () => void;
    canNewConversation: boolean;
    canClearConversation: boolean;
    canExportConversation: boolean;
}

const THREAD_META_NEW = "Just now · new";
const THREAD_META_ACTIVE = "Active thread";

export const AskSidebar: React.FC<AskSidebarProps> = ({
    turns,
    onNewConversation,
    onClearConversation,
    onExportConversation,
    canNewConversation,
    canClearConversation,
    canExportConversation,
}) => {
    const firstQuestion = turns[0]?.question ?? null;
    const hasTurns = turns.length > 0;

    return (
        <aside className="ask-sidebar">
            <div className="ask-sidebar-title">
                <h1 className="ask-sidebar-heading">Ask the Archive</h1>
            </div>

            <div className="ask-sidebar-actions">
                <button
                    type="button"
                    className="ask-sidebar-newbtn"
                    onClick={onNewConversation}
                    disabled={!canNewConversation}
                    aria-label="Start a new conversation"
                >
                    <span className="ask-sidebar-newbtn-label">
                        <Plus size={12} aria-hidden="true" />
                        <span>New conversation</span>
                    </span>
                    <span
                        className="ask-sidebar-newbtn-plus"
                        aria-hidden="true"
                    >
                        +
                    </span>
                </button>
                <button
                    type="button"
                    className="ask-sidebar-newbtn"
                    onClick={onClearConversation}
                    disabled={!canClearConversation}
                    aria-label="Clear the current conversation"
                >
                    <span className="ask-sidebar-newbtn-label">
                        <Eraser size={12} aria-hidden="true" />
                        <span>Clear conversation</span>
                    </span>
                    <span
                        className="ask-sidebar-newbtn-plus"
                        aria-hidden="true"
                    >
                        ×
                    </span>
                </button>
                <button
                    type="button"
                    className="ask-sidebar-newbtn ask-sidebar-exportbtn"
                    onClick={onExportConversation}
                    disabled={!canExportConversation}
                    aria-label="Export the conversation as a PDF"
                >
                    <span className="ask-sidebar-newbtn-label">
                        <Download size={12} aria-hidden="true" />
                        <span>Export as PDF</span>
                    </span>
                    <span
                        className="ask-sidebar-newbtn-plus"
                        aria-hidden="true"
                    >
                        ↓
                    </span>
                </button>
            </div>

            <section className="ask-sidebar-section">
                <header className="ask-sidebar-section-label">
                    <span>Thread</span>
                    <span>{hasTurns ? "1" : "0"}</span>
                </header>
                <div className="ask-sidebar-threads">
                    {firstQuestion ? (
                        <div className="ask-sidebar-thread" data-active="true">
                            <p className="ask-sidebar-thread-title">
                                {firstQuestion}
                            </p>
                            <p className="ask-sidebar-thread-meta">
                                {turns.length === 1
                                    ? THREAD_META_NEW
                                    : `${turns.length} turns · ${THREAD_META_ACTIVE}`}
                            </p>
                        </div>
                    ) : (
                        <p className="ask-sidebar-threads-empty">
                            No conversation yet. Ask a question to begin.
                        </p>
                    )}
                </div>
            </section>

        </aside>
    );
};
