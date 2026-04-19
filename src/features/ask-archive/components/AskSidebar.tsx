"use client";

import React from "react";
import { Plus, Eraser, Download } from "lucide-react";
import type { ThreadSummary } from "../hooks/askReducer";

interface AskSidebarProps {
    threads: ThreadSummary[];
    activeThreadId: string | null;
    onNewConversation: () => void;
    onClearConversation: () => void;
    onExportConversation: () => void;
    onSwitchThread: (threadId: string) => void;
    canNewConversation: boolean;
    canClearConversation: boolean;
    canExportConversation: boolean;
}

function formatRelativeTime(ts: number): string {
    const delta = Date.now() - ts;
    const mins = Math.round(delta / 60_000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    return `${days}d ago`;
}

export const AskSidebar: React.FC<AskSidebarProps> = ({
    threads,
    activeThreadId,
    onNewConversation,
    onClearConversation,
    onExportConversation,
    onSwitchThread,
    canNewConversation,
    canClearConversation,
    canExportConversation,
}) => {
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
                    <span>Threads</span>
                    <span>{threads.length}</span>
                </header>
                <div className="ask-sidebar-threads">
                    {threads.length === 0 ? (
                        <p className="ask-sidebar-threads-empty">
                            No conversation yet. Ask a question to begin.
                        </p>
                    ) : (
                        threads.map((thread) => {
                            const isActive = thread.id === activeThreadId;
                            return (
                                <button
                                    key={thread.id}
                                    type="button"
                                    className="ask-sidebar-thread"
                                    data-active={isActive ? "true" : undefined}
                                    onClick={() => onSwitchThread(thread.id)}
                                    aria-current={isActive ? "true" : undefined}
                                    aria-label={`Open thread: ${thread.firstQuestion}`}
                                >
                                    <span className="ask-sidebar-thread-title">
                                        {thread.firstQuestion}
                                    </span>
                                    <span className="ask-sidebar-thread-meta">
                                        {thread.turnCount === 1
                                            ? "1 turn"
                                            : `${thread.turnCount} turns`}
                                        {" · "}
                                        {formatRelativeTime(
                                            thread.lastUpdatedAt,
                                        )}
                                        {isActive ? " · active" : null}
                                    </span>
                                </button>
                            );
                        })
                    )}
                </div>
            </section>

        </aside>
    );
};
