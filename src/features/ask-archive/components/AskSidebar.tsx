"use client";

import React from "react";
import { RotateCcw } from "lucide-react";
import type { Turn } from "../hooks/askReducer";

interface AskSidebarProps {
    turns: Turn[];
    onNewConversation: () => void;
    canStartNewConversation: boolean;
}

const THREAD_META_NEW = "Just now · new";
const THREAD_META_ACTIVE = "Active thread";

export const AskSidebar: React.FC<AskSidebarProps> = ({
    turns,
    onNewConversation,
    canStartNewConversation,
}) => {
    const firstQuestion = turns[0]?.question ?? null;

    return (
        <aside className="ask-sidebar">
            <div className="ask-sidebar-title">
                <h1 className="ask-sidebar-heading">Ask the Archive</h1>
                <p className="ask-sidebar-sub">
                    Research desk · verify before quoting
                </p>
            </div>

            {turns.length > 0 ? (
                <button
                    type="button"
                    className="ask-sidebar-newbtn"
                    onClick={onNewConversation}
                    disabled={!canStartNewConversation}
                    aria-label="Start a new conversation"
                >
                    <span className="ask-sidebar-newbtn-label">
                        <RotateCcw size={12} aria-hidden="true" />
                        <span>New conversation</span>
                    </span>
                    <span
                        className="ask-sidebar-newbtn-plus"
                        aria-hidden="true"
                    >
                        ↺
                    </span>
                </button>
            ) : null}

            <section className="ask-sidebar-section">
                <header className="ask-sidebar-section-label">
                    <span>Thread</span>
                    <span>{turns.length > 0 ? "1" : "0"}</span>
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

            <section className="ask-sidebar-section">
                <header className="ask-sidebar-section-label">
                    <span>Archive scope</span>
                </header>
                <div className="ask-sidebar-scope">
                    <dl className="ask-sidebar-scope-stats">
                        <div className="ask-sidebar-scope-stat">
                            <dt>Coverage</dt>
                            <dd>1950 – 2006</dd>
                        </div>
                        <div className="ask-sidebar-scope-stat">
                            <dt>Editions</dt>
                            <dd>293</dd>
                        </div>
                        <div className="ask-sidebar-scope-stat">
                            <dt>Articles</dt>
                            <dd>9,582</dd>
                        </div>
                    </dl>
                    <p className="ask-sidebar-scope-range">
                        1950 — 2006
                    </p>
                </div>
            </section>
        </aside>
    );
};
